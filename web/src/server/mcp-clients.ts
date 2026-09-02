import { and, desc, eq, isNull } from "drizzle-orm";

import { McpClientNotFoundError } from "../auth/errors";
import { mcpClientSchema, type McpClient } from "../auth/integrations";
import { database, transaction } from "../db/client";
import { oauthClients, oauthConsents, oauthRefreshTokens } from "../db/schema";

/**
 * The MCP clients an account has authorized. A consent is what the OAuth
 * server checks before issuing a code without asking again. The MCP resource
 * server checks the same consent on every request.
 */

/** The clients `user` has approved, most recently approved first. */
export async function listMcpClients(user: string): Promise<McpClient[]> {
  const rows = await (
    await database()
  )
    .select({
      id: oauthConsents.id,
      clientId: oauthConsents.clientId,
      name: oauthClients.name,
      createdAt: oauthConsents.createdAt,
      updatedAt: oauthConsents.updatedAt,
    })
    .from(oauthConsents)
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
    .where(eq(oauthConsents.userId, user))
    .orderBy(desc(oauthConsents.updatedAt));
  return rows.map((row) =>
    mcpClientSchema.parse({
      id: row.id,
      clientId: row.clientId,
      name: row.name ?? row.clientId,
      grantedAt: row.createdAt.toISOString(),
      lastGrantedAt: row.updatedAt.toISOString(),
    }),
  );
}

/** Withdraw consent and every refresh path for one of `user`'s clients. */
export async function disconnectMcpClient(
  user: string,
  id: string,
): Promise<void> {
  await transaction(async (tx) => {
    const [consent] = await tx
      .delete(oauthConsents)
      .where(and(eq(oauthConsents.id, id), eq(oauthConsents.userId, user)))
      .returning({ clientId: oauthConsents.clientId });
    if (!consent) {
      throw new McpClientNotFoundError(`Unknown MCP client: ${id}`);
    }
    const now = new Date();
    await tx
      .update(oauthRefreshTokens)
      .set({ revoked: now })
      .where(
        and(
          eq(oauthRefreshTokens.userId, user),
          eq(oauthRefreshTokens.clientId, consent.clientId),
          isNull(oauthRefreshTokens.revoked),
        ),
      );
  });
}
