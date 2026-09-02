import type { JWTPayload } from "better-auth";
import { and, eq, gt } from "drizzle-orm";

import { database } from "../db/client";
import { oauthClients, oauthConsents, sessions, users } from "../db/schema";
import { deploymentEndpoint } from "./deployment";

export type ProgrammaticPrincipal =
  | {
      kind: "api_key";
      userId: string;
      credentialId: string;
    }
  | {
      kind: "mcp_client";
      userId: string;
      credentialId: string;
      consentId: string;
      sessionId: string;
    };

function stringClaim(claims: JWTPayload, name: string): string | null {
  const value = claims[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Resolve a verified MCP JWT to an authorization that is still live now. */
export async function authorizeMcpPrincipal(
  claims: JWTPayload,
): Promise<ProgrammaticPrincipal | null> {
  const userId = stringClaim(claims, "sub");
  const clientId =
    stringClaim(claims, "client_id") ?? stringClaim(claims, "azp");
  if (!userId || !clientId) return null;

  const db = await database();
  const [authorization] = await db
    .select({
      consentId: oauthConsents.id,
      resources: oauthConsents.resources,
      banned: users.banned,
      clientDisabled: oauthClients.disabled,
    })
    .from(oauthConsents)
    .innerJoin(users, eq(users.id, oauthConsents.userId))
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
    .where(
      and(
        eq(oauthConsents.userId, userId),
        eq(oauthConsents.clientId, clientId),
      ),
    );
  if (
    !authorization ||
    authorization.banned ||
    authorization.clientDisabled ||
    !authorization.resources?.includes(deploymentEndpoint().mcpResource)
  ) {
    return null;
  }

  const sessionId = stringClaim(claims, "sid");
  if (!sessionId) return null;
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  if (!session) return null;

  return {
    kind: "mcp_client",
    userId,
    credentialId: clientId,
    consentId: authorization.consentId,
    sessionId,
  };
}
