import type { JWTPayload } from "better-auth";
import { and, eq, gt } from "drizzle-orm";

import { database } from "../db/client";
import { oauthClients, oauthConsents, sessions, users } from "../db/schema";
import { deploymentEndpoint } from "./deployment";

function stringClaim(claims: JWTPayload, name: string): string | null {
  const value = claims[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The MCP client a verified JWT was issued to. */
export function mcpClientId(claims: JWTPayload): string | null {
  return stringClaim(claims, "client_id") ?? stringClaim(claims, "azp");
}

/** Whether a verified MCP JWT still stands for a live authorization. */
export async function mcpAuthorizationIsLive(
  claims: JWTPayload,
): Promise<boolean> {
  const userId = stringClaim(claims, "sub");
  const clientId = mcpClientId(claims);
  if (!userId || !clientId) return false;

  const db = await database();
  const [authorization] = await db
    .select({
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
    return false;
  }

  const sessionId = stringClaim(claims, "sid");
  if (!sessionId) return false;
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
  return session !== undefined;
}
