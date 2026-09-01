import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  originValidationResponse,
} from "@modelcontextprotocol/server";

import packageJson from "../../package.json";
import { agentOperations } from "./agent-operations";

/**
 * The MCP face of the agent operations: every tool is one registry entry, so
 * the tool list can never drift from the HTTP surface. Image bytes do not
 * travel through MCP; agents upload them to /api/agent/images and pass the
 * returned digest to assign-images-to-observation.
 */
function buildServer(): McpServer {
  const server = new McpServer({
    name: "vitroflow",
    version: packageJson.version,
  });
  for (const operation of agentOperations.values()) {
    server.registerTool(
      operation.name,
      {
        description: operation.description,
        inputSchema: operation.input,
        outputSchema: operation.output,
        annotations: operation.annotations,
      },
      async (args) => {
        const outcome = await operation.run(args);
        if (!outcome.ok) {
          return {
            content: [{ type: "text", text: outcome.message }],
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

export const mcpHandler = createMcpHandler(buildServer);

/**
 * MCP requests are accepted only for local development hostnames or hostnames
 * explicitly named in VITROFLOW_MCP_ALLOWED_HOSTNAMES. Browser requests must
 * also carry an Origin from the same allowlist; non-browser clients omit it.
 */
export function guardMcpRequest(request: Request): Response | null {
  const configured = (process.env.VITROFLOW_MCP_ALLOWED_HOSTNAMES ?? "")
    .split(",")
    .map((hostname) => hostname.trim())
    .filter((hostname) => hostname.length > 0);
  return (
    hostHeaderValidationResponse(request, [
      ...localhostAllowedHostnames(),
      ...configured,
    ]) ??
    originValidationResponse(request, [
      ...localhostAllowedOrigins(),
      ...configured,
    ]) ??
    null
  );
}
