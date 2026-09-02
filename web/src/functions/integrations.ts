import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { APIError } from "better-auth/api";
import { z } from "zod";

import {
  apiKeyCreateSchema,
  apiKeyRefSchema,
  mcpClientRefSchema,
} from "../auth/integrations";
import { issueApiKey, listApiKeys, revokeApiKey } from "../server/api-keys";
import { auth } from "../server/auth";
import { deploymentEndpoint } from "../server/deployment";
import { disconnectMcpClient, listMcpClients } from "../server/mcp-clients";
import { readSession } from "../server/session";

async function actor(): Promise<string> {
  const user = await readSession(getRequestHeaders());
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user.id;
}

export const getIntegrations = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await actor();
    const [apiKeys, mcpClients] = await Promise.all([
      listApiKeys(user),
      listMcpClients(user),
    ]);
    return {
      apiKeys,
      mcpClients,
      mcpUrl: deploymentEndpoint().mcpResource,
    };
  },
);

export const addApiKey = createServerFn({ method: "POST" })
  .validator(apiKeyCreateSchema)
  .handler(async ({ data }) => issueApiKey(await actor(), data));

export const removeApiKey = createServerFn({ method: "POST" })
  .validator(apiKeyRefSchema)
  .handler(async ({ data }) => revokeApiKey(await actor(), data.key));

export const removeMcpClient = createServerFn({ method: "POST" })
  .validator(mcpClientRefSchema)
  .handler(async ({ data }) => disconnectMcpClient(await actor(), data.client));

/** The client named by an authorization request, as the consent page shows it. */
export const describeOAuthClient = createServerFn({ method: "GET" })
  .validator(z.object({ clientId: z.string() }))
  .handler(async ({ data }) => {
    const client = await (
      await auth()
    ).api
      .getOAuthClientPublic({
        query: { client_id: data.clientId },
        headers: getRequestHeaders(),
      })
      .catch((error: unknown) => {
        if (error instanceof APIError && error.statusCode === 404) {
          throw notFound();
        }
        throw error;
      });
    return {
      name: client.client_name ?? data.clientId,
      uri: client.client_uri ?? null,
    };
  });
