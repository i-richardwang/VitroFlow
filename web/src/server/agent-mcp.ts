import { requireMcpAuth } from "@better-auth/mcp";
import {
  type AuthInfo,
  type McpRequestContext,
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
import { z } from "zod";

import packageJson from "../../package.json";
import { executeAgentOperation } from "./agent-execution";
import { type AgentOperation, agentOperations } from "./agent-operations";
import { auth } from "./auth";
import { bearerToken } from "./bearer";
import { deploymentEndpoint } from "./deployment";
import {
  authorizeMcpPrincipal,
  type ProgrammaticPrincipal,
} from "./programmatic-access";

/**
 * The MCP face of the agent operations: every tool is one registry entry, so
 * the tool list can never drift from the HTTP surface. Image bytes do not
 * travel through MCP; agents upload them to /api/agent/images and pass the
 * returned digest to assign-images-to-observation.
 */
function principalFrom(authInfo: AuthInfo | undefined): ProgrammaticPrincipal {
  const principal = authInfo?.extra?.principal;
  if (
    !principal ||
    typeof principal !== "object" ||
    !("kind" in principal) ||
    !("userId" in principal) ||
    !("credentialId" in principal)
  ) {
    throw new Error("MCP request has no programmatic principal");
  }
  return principal as ProgrammaticPrincipal;
}

function toolAnnotations(operation: AgentOperation): ToolAnnotations {
  return operation.kind === "query"
    ? { readOnlyHint: true, openWorldHint: false }
    : {
        destructiveHint: operation.destructive,
        idempotentHint: true,
        openWorldHint: false,
      };
}

function buildServer(context: McpRequestContext): McpServer {
  const server = new McpServer({
    name: "vitroflow",
    version: packageJson.version,
  });
  for (const operation of agentOperations.values()) {
    const mutationInput = z.strictObject({
      idempotencyKey: z.string().uuid(),
      input: operation.input,
    });
    const inputSchema =
      operation.kind === "query" ? operation.input : mutationInput;
    server.registerTool(
      operation.name,
      {
        description: operation.description,
        inputSchema,
        outputSchema: operation.output,
        annotations: toolAnnotations(operation),
      },
      async (args) => {
        const call =
          operation.kind === "query"
            ? { input: args, idempotencyKey: null }
            : mutationInput.parse(args);
        const outcome = await executeAgentOperation(
          operation.name,
          call.input,
          principalFrom(context.authInfo),
          call.idempotencyKey,
        );
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
        const principal = await authorizeMcpPrincipal(claims);
        if (!principal) {
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
            clientId: principal.credentialId,
            scopes,
            expiresAt: claims.exp,
            resource: new URL(deployment.mcpResource),
            extra: { principal },
          },
        });
      },
      { resource: deployment.mcpResource },
    );
  });
  return (await protectedHandler)(request);
}
