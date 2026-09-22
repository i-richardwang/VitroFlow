import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

type ToolReply = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  complete?: boolean;
};

export default async function (pi: ExtensionAPI) {
  const config = JSON.parse(
    await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "tools.json"),
      "utf8",
    ),
  );
  for (const tool of config.definitions) {
    pi.registerTool(
      defineTool({
        name: tool.name,
        label: tool.name,
        description: tool.description,
        parameters: Type.Unsafe(tool.inputSchema),
        async execute(_id, args, signal) {
          const result = await new Promise<ToolReply>((resolve, reject) => {
            const process = spawn(
              config.command[0],
              [...config.command.slice(1), "invoke"],
              { signal, timeout: 30000 },
            );
            let output = "",
              error = "";
            process.stdout.on("data", (data) => {
              output += data;
            });
            process.stderr.on("data", (data) => {
              error += data;
            });
            process.on("error", reject);
            process.on("close", (code) => {
              if (code !== 0)
                return reject(
                  new Error(error || "Annotation operation failed"),
                );
              try {
                resolve(JSON.parse(output));
              } catch (error) {
                reject(error);
              }
            });
            process.stdin.end(
              JSON.stringify({ name: tool.name, arguments: args }),
            );
          });
          return {
            content: result.content,
            details: {},
            terminate: result.complete === true,
          };
        },
      }),
    );
  }
}
