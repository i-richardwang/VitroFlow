import { isTaskToken, verifyTaskToken } from "./task-credentials";
import type { AnnotationPrincipal } from "../../../domain/annotation-runs/access";
import { registerAnnotationTools } from "./annotation";
import { validateTaskPrincipal } from "../../annotation-runs/public";
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
  type McpRequestContext,
  originValidationResponse,
} from "@modelcontextprotocol/server";

import packageJson from "../../../../package.json";
import {
  executeAgentOperation,
  type AgentOperation,
  agentOperations,
} from "../../agent/public";

import {
  auth,
  bearerToken,
  mcpAuthorizationIsLive,
  mcpClientId,
} from "../../auth/public";

import { deploymentEndpoint } from "../../infra/deployment";

/**
 * The MCP face of the agent operations: every tool is one registry entry, so
 * the business tool list cannot drift from the HTTP surface. Annotation
 * tools additionally return images and are scoped to a user or region attempt.
 */
function toolAnnotations(operation: AgentOperation): ToolAnnotations {
  return operation.kind === "query"
    ? { readOnlyHint: true, openWorldHint: false }
    : { destructiveHint: operation.destructive, openWorldHint: false };
}

function buildServer({ authInfo }: McpRequestContext): McpServer {
  const principal = authInfo?.extra?.annotationPrincipal as
    AnnotationPrincipal | undefined;
  const server = new McpServer({
    name: "vitroflow",
    version: packageJson.version,
  });
  if (principal) registerAnnotationTools(server, principal);
  for (const operation of principal?.kind === "task"
    ? []
    : agentOperations.values()) {
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
  const credential = bearerToken(request);
  if (credential && isTaskToken(credential)) {
    const principal = verifyTaskToken(credential);
    if (!principal)
      return new Response("Invalid annotation credential", { status: 401 });
    try {
      await validateTaskPrincipal(principal);
    } catch {
      return new Response("Inactive annotation credential", { status: 401 });
    }
    return mcpHandler.fetch(request, {
      authInfo: {
        token: credential,
        clientId: "annotation-task",
        scopes: ["annotation:task"],
        extra: { annotationPrincipal: principal },
      },
    });
  }
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
            extra: {
              annotationPrincipal: {
                kind: "user",
                userId: claims.sub,
                clientId,
              },
            },
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
