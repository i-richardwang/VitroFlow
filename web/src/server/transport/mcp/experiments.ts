import {
  createMcpHandler,
  McpServer,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";

import packageJson from "../../../../package.json";
import {
  executeAgentOperation,
  type AgentOperation,
  agentOperations,
} from "../../agent/public";
import { guardMcpRequest, serveWithOAuth } from "./access";

/**
 * The experiment MCP server: the MCP face of the agent operations. Every tool
 * is one registry entry, so the tool list cannot drift from the HTTP surface.
 */
function toolAnnotations(operation: AgentOperation): ToolAnnotations {
  return operation.kind === "query"
    ? { readOnlyHint: true, openWorldHint: false }
    : { destructiveHint: operation.destructive, openWorldHint: false };
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: "vitroflow-experiments",
    version: packageJson.version,
  });
  for (const operation of agentOperations.values()) {
    server.registerTool(
      operation.name,
      {
        description: operation.description,
        inputSchema: operation.input,
        outputSchema: operation.output,
        annotations: toolAnnotations(operation),
      },
      async (args) => {
        const outcome = await executeAgentOperation(operation.name, args);
        if (!outcome.ok) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  code: outcome.code,
                  message: outcome.message,
                }),
              },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(outcome.output) }],
          structuredContent: outcome.output,
        };
      },
    );
  }
  return server;
}

export const experimentsMcpHandler = createMcpHandler(buildServer, {
  legacy: "stateless",
});

/** The experiment server opens to the accounts' authorized MCP clients. */
export async function serveExperimentsMcp(request: Request): Promise<Response> {
  return (
    guardMcpRequest(request) ??
    serveWithOAuth("experiments", request, (accepted, grant) =>
      experimentsMcpHandler.fetch(accepted, {
        authInfo: {
          token: grant.token,
          clientId: grant.clientId,
          scopes: grant.scopes,
          expiresAt: grant.expiresAt,
          resource: grant.resource,
        },
      }),
    )
  );
}
