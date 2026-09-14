/** Pi tools expose the annotation CLI without a general-purpose shell. */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export default async function (pi: ExtensionAPI) {
  const root = dirname(fileURLToPath(import.meta.url));
  const config = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
  const manifest = JSON.parse(
    await readFile(join(config.package, "manifest.json"), "utf8"),
  );
  pi.registerTool(
    defineTool({
      name: "annotation_view",
      label: "View annotation region",
      description:
        "View the exact clean image, dimensions, and optional candidate boxes for a task. All box coordinates use this displayed image's pixels.",
      parameters: Type.Object({ taskId: Type.String() }),
      async execute(_id, { taskId }) {
        const task = manifest.tasks.find(
          (item: { id: string }) => item.id === taskId,
        );
        if (!task)
          throw new Error("Unknown task; use a taskId from the assignment");
        const folder = join(config.package, "tasks", taskId);
        const prelabels = JSON.parse(
          await readFile(join(folder, "prelabels.json"), "utf8"),
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ task, candidates: prelabels.instances }),
            },
            {
              type: "image" as const,
              data: (await readFile(join(folder, "clean.png"))).toString(
                "base64",
              ),
              mimeType: "image/png",
            },
          ],
          details: {},
        };
      },
    }),
  );
  const box = Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Number({ exclusiveMinimum: 0 }),
    height: Type.Number({ exclusiveMinimum: 0 }),
  });
  const parameters = Type.Object({
    taskId: Type.String(),
    instances: Type.Array(
      Type.Object({
        id: Type.String(),
        class: Type.String(),
        bbox: box,
        uncertain: Type.Optional(Type.Boolean()),
        truncated: Type.Optional(Type.Boolean()),
      }),
    ),
    issues: Type.Array(Type.Object({ bbox: box, reason: Type.String() })),
  });
  for (const operation of ["preview", "submit"] as const) {
    pi.registerTool(
      defineTool({
        name: `annotation_${operation}`,
        label: `Annotation ${operation}`,
        description:
          operation === "preview"
            ? "Validate a complete task response and display its boxes over the image. Coordinates use clean.png display pixels."
            : "Validate and accept a complete task response, including an empty region. Supply all instances and unresolved issues, not only edits.",
        parameters,
        async execute(_id, params, signal, _update, context) {
          if (
            !manifest.tasks.some(
              (task: { id: string }) => task.id === params.taskId,
            )
          )
            throw new Error("Unknown annotation task");
          const folder = join(root, "responses", randomUUID());
          await mkdir(folder, { recursive: true });
          const file = join(folder, "response.json");
          await writeFile(
            file,
            JSON.stringify({
              schemaVersion: manifest.schemaVersion,
              packageId: manifest.packageId,
              taskId: params.taskId,
              producer: `pi/${context.model?.provider}/${context.model?.id}`,
              instances: params.instances,
              issues: params.issues,
            }),
          );
          const output = join(folder, "preview");
          const args = [
            ...config.command.slice(1),
            "annotate",
            operation,
            "--run",
            config.package,
            "--task",
            params.taskId,
            "--file",
            file,
            ...(operation === "preview" ? ["--output", output] : []),
          ];
          const response = await pi.exec(config.command[0], args, {
            signal,
            timeout: 30000,
          });
          if (response.code !== 0)
            throw new Error(
              response.stderr || response.stdout || "Annotation command failed",
            );
          if (operation === "preview") {
            return {
              content: [
                { type: "text" as const, text: response.stdout },
                {
                  type: "image" as const,
                  data: (await readFile(join(output, "proposed.png"))).toString(
                    "base64",
                  ),
                  mimeType: "image/png",
                },
              ],
              details: {},
            };
          }
          const state = await pi.exec(
            config.command[0],
            [
              ...config.command.slice(1),
              "annotate",
              "status",
              "--run",
              config.package,
            ],
            { signal, timeout: 30000 },
          );
          if (state.code !== 0)
            throw new Error(
              state.stderr || "Unable to verify annotation progress",
            );
          const complete = JSON.parse(state.stdout).complete === true;
          return {
            content: [{ type: "text" as const, text: state.stdout }],
            details: {},
            terminate: complete,
          };
        },
      }),
    );
  }
}
