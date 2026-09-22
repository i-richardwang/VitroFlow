import type { AnnotationPrincipal } from "../../../domain/annotation-runs/access";
import { AnnotationRunConflictError } from "../../../domain/annotation-runs/errors";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  annotationRefSchema,
  annotationInstanceSchema,
} from "../../../domain/annotation/schema";
import {
  annotationViewInput,
  annotationPreviewInput,
  annotationSubmitInput,
} from "../../../domain/annotation-runs/tasks";
import {
  createAnnotationRun,
  nextAnnotationTask,
  viewAnnotationTask,
  previewAnnotationTask,
  submitProposal,
  type AnnotationPanel,
} from "../../annotation-runs/public";

const textContent = (value: unknown) => ({
  type: "text" as const,
  text: typeof value === "string" ? value : JSON.stringify(value),
});
const content = (panels: AnnotationPanel[]) =>
  panels.map((panel) =>
    panel.kind === "image"
      ? {
          type: "image" as const,
          data: panel.bytes.toString("base64"),
          mimeType: "image/png",
        }
      : textContent(panel.value),
  );

/** One schema and handler per operation, independent of the calling runtime. */
export function registerAnnotationTools(
  server: McpServer,
  principal: AnnotationPrincipal,
) {
  function register<S extends z.ZodObject>(
    name: string,
    description: string,
    inputSchema: S,
    readOnly: boolean,
    call: (args: z.infer<S>) => Promise<{
      content: (
        | ReturnType<typeof textContent>
        | { type: "image"; data: string; mimeType: string }
      )[];
    }>,
  ) {
    const schema: z.ZodType = inputSchema;
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          return await call(inputSchema.parse(args));
        } catch (error) {
          const expected =
            error instanceof AnnotationRunConflictError ||
            error instanceof z.ZodError;
          if (!expected) console.error("Annotation tool failed", error);
          return {
            isError: true,
            content: [
              textContent(
                expected ? error.message : "Annotation operation failed",
              ),
            ],
          };
        }
      },
    );
  }
  if (principal.kind === "user") {
    register(
      "annotation_start",
      "Create or reopen an annotation run for an image and model. Reuse requestId to retry. Then call annotation_next, view, preview and submit until complete. Results remain unreviewed AI proposals.",
      z.strictObject({
        requestId: z.string().uuid(),
        ref: annotationRefSchema,
        input: z
          .array(annotationInstanceSchema)
          .max(10000)
          .nullable()
          .default(null),
      }),
      false,
      async (args) => {
        const run = await createAnnotationRun(
          {
            id: args.requestId,
            ref: args.ref,
            input: args.input,
            executor: { kind: "interactive" },
          },
          principal.userId,
        );
        return {
          content: [
            textContent({
              runId: run.id,
              status: run.status,
              progress: run.progress,
            }),
          ],
        };
      },
    );
    register(
      "annotation_next",
      "Get progress and the next unfinished region; safely resumes the current region after interruption. A null taskId means all regions are complete.",
      z.strictObject({ runId: z.string().min(1) }),
      false,
      async (args) => ({
        content: [textContent(await nextAnnotationTask(principal, args.runId))],
      }),
    );
  }
  register(
    "annotation_view",
    "View the assigned region: image evidence, full-image locator and optional reference boxes. Follow the returned annotation rules.",
    annotationViewInput,
    true,
    async (args) => {
      return {
        content: content(await viewAnnotationTask(principal, args.taskId)),
      };
    },
  );
  register(
    "annotation_preview",
    "Preview a complete proposal with normalized box_2d edges. Returns CLEAN, PROPOSED and proposalId. Inspect the images before submitting.",
    annotationPreviewInput,
    false,
    async (args) => {
      const { panels, proposalId } = await previewAnnotationTask(
        principal,
        args.taskId,
        { instances: args.instances, issues: args.issues },
      );
      return {
        content: [textContent({ proposalId }), ...content(panels)],
      };
    },
  );
  register(
    "annotation_submit",
    "Accept exactly the previewed proposal. Idempotent for the same proposalId. The server merges the final region automatically; do not upload a separate whole-image result.",
    annotationSubmitInput,
    false,
    async (args) => ({
      content: [
        textContent(
          await submitProposal(principal, args.taskId, args.proposalId),
        ),
      ],
    }),
  );
}
