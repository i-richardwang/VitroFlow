import {
  createMcpHandler,
  McpServer,
  type McpRequestContext,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import packageJson from "../../../../package.json";
import { readAnnotationReading } from "../../readings/public";
import type { AnnotationPrincipal } from "../../../domain/annotation-runs/access";
import {
  AnnotationRunConflictError,
  AnnotationRunNotFoundError,
} from "../../../domain/annotation-runs/errors";
import { annotationRefSchema } from "../../../domain/annotation/schema";
import {
  annotationInputSchema,
  annotationScopeSchema,
} from "../../../domain/annotation-runs/schema";
import {
  annotationViewInput,
  annotationPreviewInput,
  annotationSubmitInput,
} from "../../../domain/annotation-runs/tasks";
import {
  createAnnotationRun,
  cancelOwnAnnotationRun,
  nextAnnotationTask,
  viewAnnotationTask,
  previewAnnotationTask,
  submitProposal,
  interactiveAnnotationEnabled,
  validateTaskPrincipal,
  type AnnotationPanel,
} from "../../annotation-runs/public";
import {
  guardMcpRequest,
  rejectUnsupportedMcpMethod,
  serveWithOAuth,
} from "./access";
import { isTaskToken, verifyTaskToken } from "./task-credentials";
import { bearerToken } from "../../auth/public";

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
function registerAnnotationTools(
  server: McpServer,
  principal: AnnotationPrincipal,
) {
  function register<S extends z.ZodObject>(
    name: string,
    description: string,
    inputSchema: S,
    annotations: ToolAnnotations,
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
          destructiveHint: false,
          openWorldHint: false,
          ...annotations,
        },
      },
      async (args) => {
        try {
          return await call(inputSchema.parse(args));
        } catch (error) {
          const expected =
            error instanceof AnnotationRunConflictError ||
            error instanceof AnnotationRunNotFoundError ||
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
      "annotation_read",
      "Read how an image is currently annotated for a model: the reviewer's boxes, the AI proposal and the detection, in source pixels, which of them the image reads by, and the run in progress with its progress. Start here before starting or continuing a run.",
      z.strictObject({ ref: annotationRefSchema }),
      { readOnlyHint: true },
      async (args) => ({
        content: [textContent(await readAnnotationReading(args.ref))],
      }),
    );
    register(
      "annotation_start",
      "Start an annotation run for an image and model. input is the boxes to begin from: a complete list, the name of a reading annotation_read lists (review, proposal or detection), or null for none. scope limits the run to the regions touched by these source-pixel boxes; regions outside keep the input boxes, so scope needs input. An image has one run in progress at a time; when yours already is, continue it with annotation_next. Results remain unreviewed AI proposals.",
      z.strictObject({
        ref: annotationRefSchema,
        input: annotationInputSchema.default(null),
        scope: annotationScopeSchema.default(null),
      }),
      { readOnlyHint: false },
      async (args) => {
        const run = await createAnnotationRun(
          args,
          "interactive",
          principal.userId,
        );
        return { content: [textContent({ progress: run.progress })] };
      },
    );
    register(
      "annotation_next",
      "Get the next region of the image's run in progress, with progress. It returns the same region until that region is accepted, so the run continues from any conversation. Then view, preview and submit it, and repeat until annotation_submit reports the run succeeded.",
      z.strictObject({ ref: annotationRefSchema }),
      { readOnlyHint: false },
      async (args) => ({
        content: [textContent(await nextAnnotationTask(principal, args.ref))],
      }),
    );
    register(
      "annotation_cancel",
      "Cancel your run in progress on the image, discarding its accepted regions, to start again with another input or scope.",
      z.strictObject({ ref: annotationRefSchema }),
      { readOnlyHint: false, destructiveHint: true },
      async (args) => {
        await cancelOwnAnnotationRun(principal, args.ref);
        return { content: [textContent({ cancelled: true })] };
      },
    );
  }
  register(
    "annotation_view",
    "View the assigned region: image evidence, full-image locator and optional reference boxes. Follow the returned annotation rules.",
    annotationViewInput,
    { readOnlyHint: true },
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
    { readOnlyHint: false },
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
    { readOnlyHint: false, idempotentHint: true },
    async (args) => ({
      content: [
        textContent(
          await submitProposal(principal, args.taskId, args.proposalId),
        ),
      ],
    }),
  );
}

/**
 * The annotation MCP server: drawing boxes on images, region by region. A
 * Worker's agent holds a task credential for one region; a person's own agent
 * holds an OAuth grant and drives whole runs while an administrator allows it.
 */
function buildServer({ authInfo }: McpRequestContext): McpServer {
  const principal = authInfo?.extra?.annotationPrincipal as AnnotationPrincipal;
  const server = new McpServer(
    { name: "vitroflow-annotation", version: packageJson.version },
    {
      instructions:
        principal.kind === "user"
          ? "Annotate images for a model by drawing boxes region by region. Read the image with annotation_read, start or continue its run with annotation_start and annotation_next, then view, preview and submit each region until the run succeeds. Results are AI proposals a person reviews."
          : "Annotate the one region this credential names: view it, preview a complete proposal, and submit exactly what you previewed.",
    },
  );
  registerAnnotationTools(server, principal);
  return server;
}

export const annotationMcpHandler = createMcpHandler(buildServer, {
  legacy: "reject",
});

const refused = (message: string, status: number) =>
  Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message } },
    { status },
  );

/**
 * A task credential opens the server for its region while the Worker's
 * attempt stands; an OAuth grant opens it for the account while interactive
 * annotation is allowed.
 */
export async function serveAnnotationMcp(request: Request): Promise<Response> {
  const guarded = guardMcpRequest(request);
  if (guarded) return guarded;
  const credential = bearerToken(request);
  if (credential && isTaskToken(credential)) {
    const principal = verifyTaskToken(credential);
    if (!principal) return refused("Invalid annotation credential", 401);
    try {
      await validateTaskPrincipal(principal);
    } catch {
      return refused("Inactive annotation credential", 401);
    }
    const methodRefusal = rejectUnsupportedMcpMethod(request);
    if (methodRefusal) return methodRefusal;
    return annotationMcpHandler.fetch(request, {
      authInfo: {
        token: credential,
        clientId: "annotation-task",
        scopes: ["annotation:task"],
        extra: { annotationPrincipal: principal },
      },
    });
  }
  return serveWithOAuth("annotation", request, async (accepted, grant) => {
    if (!(await interactiveAnnotationEnabled()))
      return refused(
        "An administrator has turned off annotation by personal agents",
        403,
      );
    const principal: AnnotationPrincipal = {
      kind: "user",
      userId: grant.userId,
      clientId: grant.clientId,
    };
    return annotationMcpHandler.fetch(accepted, {
      authInfo: {
        token: grant.token,
        clientId: grant.clientId,
        scopes: grant.scopes,
        expiresAt: grant.expiresAt,
        resource: grant.resource,
        extra: { annotationPrincipal: principal },
      },
    });
  });
}
