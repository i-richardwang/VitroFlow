import { requireMcpAuth } from "@better-auth/mcp";
import {
  bearerAuthChallengeResponse,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  OAuthError,
  OAuthErrorCode,
  originValidationResponse,
} from "@modelcontextprotocol/server";

import type { McpServerName } from "../../../domain/auth/integrations";
import {
  auth,
  bearerToken,
  mcpAuthorizationIsLive,
  mcpClientId,
} from "../../auth/public";
import { deploymentEndpoint } from "../../infra/deployment";

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

/** The account and client behind a live OAuth access token. */
interface McpGrant {
  userId: string;
  clientId: string;
  token: string;
  scopes: string[];
  expiresAt?: number;
  resource: URL;
}

const METADATA_PATH = "/.well-known/oauth-protected-resource";

type GrantHandler = (request: Request, grant: McpGrant) => Promise<Response>;
type RequestHandler = (request: Request) => Promise<Response>;

const gates = new Map<McpServerName, Promise<RequestHandler>>();

/**
 * One MCP server behind OAuth: a request without a valid access token for
 * that server's resource is answered with the RFC 9728 challenge that points
 * clients at the authorization server.
 */
export async function serveWithOAuth(
  server: McpServerName,
  request: Request,
  handle: GrantHandler,
): Promise<Response> {
  let gate = gates.get(server);
  if (!gate) {
    gate = auth().then((instance) => {
      const deployment = deploymentEndpoint();
      const resource = deployment.mcpResources[server];
      return requireMcpAuth(
        instance,
        async (accepted, claims) => {
          const clientId = mcpClientId(claims);
          const userId = claims.sub;
          if (!clientId || !userId || !(await mcpAuthorizationIsLive(claims))) {
            return bearerAuthChallengeResponse(
              new OAuthError(
                OAuthErrorCode.InvalidToken,
                "The account or MCP authorization is no longer active",
              ),
              {
                resourceMetadataUrl: `${deployment.origin}${METADATA_PATH}${new URL(resource).pathname}`,
              },
            );
          }
          const token = bearerToken(accepted);
          if (!token)
            throw new Error("Verified MCP request has no bearer token");
          return handle(accepted, {
            userId,
            clientId,
            token,
            scopes:
              typeof claims.scope === "string"
                ? claims.scope.split(" ").filter(Boolean)
                : [],
            expiresAt: claims.exp,
            resource: new URL(resource),
          });
        },
        { resource },
      );
    });
    gates.set(server, gate);
  }
  return (await gate)(request);
}

/**
 * RFC 9728 metadata for the annotation server. The authorization server
 * describes the experiment server it was configured with; the annotation
 * server shares everything but its resource identifier.
 */
export async function annotationResourceMetadata(
  request: Request,
): Promise<Response | null> {
  const { origin, mcpResources } = deploymentEndpoint();
  const annotation = new URL(mcpResources.annotation);
  if (
    new URL(request.url).pathname !== `${METADATA_PATH}${annotation.pathname}`
  )
    return null;
  const experiments = await (
    await auth()
  ).handler(
    new Request(
      `${origin}${METADATA_PATH}${new URL(mcpResources.experiments).pathname}`,
    ),
  );
  if (!experiments.ok) return experiments;
  const metadata = (await experiments.json()) as Record<string, unknown>;
  const headers = new Headers(experiments.headers);
  headers.delete("content-length");
  return new Response(
    request.method === "HEAD"
      ? null
      : JSON.stringify({ ...metadata, resource: mcpResources.annotation }),
    { headers },
  );
}
