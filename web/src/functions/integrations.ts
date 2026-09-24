import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { APIError } from "better-auth/api";
import { z } from "zod";

import {
  apiKeyCreateSchema,
  apiKeyRefSchema,
  mcpClientRefSchema,
} from "../domain/auth/integrations";
import { isAdmin } from "../domain/auth/schema";
import {
  interactiveAnnotationEnabled,
  setInteractiveAnnotation,
} from "../server/annotation-runs/public";
import {
  issueApiKey,
  listApiKeys,
  revokeApiKey,
  auth,
  disconnectMcpClient,
  listMcpClients,
} from "../server/auth/public";

import { deploymentEndpoint } from "../server/infra/deployment";

import { readSession } from "../server/transport/http/session";

async function signedIn() {
  const user = await readSession(getRequestHeaders());
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}

const actor = async () => (await signedIn()).id;

export const getIntegrations = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await actor();
    const [apiKeys, mcpClients, interactiveAnnotation] = await Promise.all([
      listApiKeys(user),
      listMcpClients(user),
      interactiveAnnotationEnabled(),
    ]);
    return {
      apiKeys,
      mcpClients,
      mcpUrl: deploymentEndpoint().mcpResource,
      interactiveAnnotation,
    };
  },
);

export const changeInteractiveAnnotation = createServerFn({ method: "POST" })
  .validator(z.object({ enabled: z.boolean() }))
  .handler(async ({ data }) => {
    if (!isAdmin(await signedIn()))
      throw new Response("Forbidden", { status: 403 });
    await setInteractiveAnnotation(data.enabled);
  });

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
