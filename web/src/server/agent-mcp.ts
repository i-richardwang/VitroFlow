import { requireMcpAuth } from "@better-auth/mcp";
import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  type ToolAnnotations,
  originValidationResponse,
} from "@modelcontextprotocol/server";

import packageJson from "../../package.json";
import { executeAgentOperation } from "./agent-execution";
import { type AgentOperation, agentOperations } from "./agent-operations";
import { auth } from "./auth";
import { bearerToken } from "./bearer";
import { deploymentEndpoint } from "./deployment";
import { mcpAuthorizationIsLive, mcpClientId } from "./programmatic-access";

/**
 * The MCP face of the agent operations: every tool is one registry entry, so
 * the tool list can never drift from the HTTP surface. Image bytes do not
 * travel through MCP; agents upload them to /api/agent/images and pass the
 * returned digest to assign-images-to-observation.
 */
function toolAnnotations(operation: AgentOperation): ToolAnnotations {
  return operation.kind === "query"
    ? { readOnlyHint: true, openWorldHint: false }
    : { destructiveHint: operation.destructive, openWorldHint: false };
}

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

export const mcpHandler = createMcpHandler(buildServer, { legacy: "reject" });

/**
 * MCP requests are accepted only for local development hostnames or the
 * public origin browsers reach the workbench at. Browser requests must also
 * carry an Origin from the same set; non-browser clients omit it.
 */
export function guardMcpRequest(request: Request): Response | null {
  const deployment = deploymentEndpoint();
  return (
    hostHeaderValidationResponse(request, [
      ...localhostAllowedHostnames(),
      deployment.hostname,
    ]) ??
    originValidationResponse(request, [
      ...localhostAllowedOrigins(),
      deployment.hostname,
    ]) ??
    null
  );
}

type RequestHandler = (request: Request) => Promise<Response>;

let protectedHandler: Promise<RequestHandler> | undefined;

/**
 * The MCP endpoint behind OAuth: a request without a valid access token for
 * the workbench's MCP resource is answered with the RFC 9728 challenge that
 * points clients at the authorization server.
 */
export async function serveMcp(request: Request): Promise<Response> {
  const refused = guardMcpRequest(request);
  if (refused) return refused;
  protectedHandler ??= auth().then((instance) => {
    const deployment = deploymentEndpoint();
    return requireMcpAuth(
      instance,
      async (accepted, claims) => {
        const clientId = mcpClientId(claims);
        if (!clientId || !(await mcpAuthorizationIsLive(claims))) {
          return bearerAuthChallengeResponse(
            new OAuthError(
              OAuthErrorCode.InvalidToken,
              "The account or MCP authorization is no longer active",
            ),
            {
              resourceMetadataUrl: `${deployment.origin}/.well-known/oauth-protected-resource/api/mcp`,
            },
          );
        }
        const token = bearerToken(accepted);
        if (!token) throw new Error("Verified MCP request has no bearer token");
        const scopes =
          typeof claims.scope === "string"
            ? claims.scope.split(" ").filter(Boolean)
            : [];
        return mcpHandler.fetch(accepted, {
          authInfo: {
            token,
            clientId,
            scopes,
            expiresAt: claims.exp,
            resource: new URL(deployment.mcpResource),
          },
        });
      },
      { resource: deployment.mcpResource },
    );
  });
  return (await protectedHandler)(request);
}
