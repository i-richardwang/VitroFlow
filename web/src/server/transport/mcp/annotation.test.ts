import { describe, expect, test } from "bun:test";

import { issueTaskToken } from "./task-credentials";
import { serveAnnotationMcp } from "./annotation";
import { serveExperimentsMcp } from "./experiments";
import { annotationResourceMetadata } from "./access";
import { disconnectMcpClient, listMcpClients } from "../../auth/mcp-clients";
import {
  authorizeMcpClient,
  observeImages,
  signInAs,
  testHeartbeat,
} from "../../testing/fixtures";
import { modernRequest, rpcMessage } from "../../testing/mcp";
import {
  createAnnotationRun,
  claimAnnotationRun,
  assignWorkerTask,
  cancelAnnotationRun,
  setInteractiveAnnotation,
} from "../../annotation-runs/public";
import { recordWorkerHeartbeat } from "../../workers/public";

const annotationEndpoint = () =>
  `${process.env.BETTER_AUTH_URL}/api/annotation/mcp`;
const experimentsEndpoint = () =>
  `${process.env.BETTER_AUTH_URL}/api/experiments/mcp`;

const annotation = (
  token: string,
  method: string,
  params?: Record<string, unknown>,
) =>
  serveAnnotationMcp(
    modernRequest(annotationEndpoint(), method, params, token),
  );
const experiments = (token: string) =>
  serveExperimentsMcp(
    modernRequest(experimentsEndpoint(), "tools/list", undefined, token),
  );

async function toolNames(response: Response): Promise<string[]> {
  expect(response.status).toBe(200);
  return (await rpcMessage(response)).result.tools
    .map((tool: { name: string }) => tool.name)
    .sort();
}

const USER_TOOLS = [
  "annotation_cancel",
  "annotation_next",
  "annotation_preview",
  "annotation_read",
  "annotation_start",
  "annotation_submit",
  "annotation_view",
];

describe("annotation MCP authorization", () => {
  test("a request without a token is challenged toward the annotation resource metadata", async () => {
    const response = await serveAnnotationMcp(
      modernRequest(annotationEndpoint(), "tools/list"),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `${process.env.BETTER_AUTH_URL}/.well-known/oauth-protected-resource/api/annotation/mcp`,
    );
  });

  test("the resource metadata differs from the experiment server's only in its resource", async () => {
    const path = "/.well-known/oauth-protected-resource";
    const own = await annotationResourceMetadata(
      new Request(`${process.env.BETTER_AUTH_URL}${path}/api/annotation/mcp`),
    );
    expect(own?.status).toBe(200);
    const shared = await fetch(
      `${process.env.BETTER_AUTH_URL}${path}/api/experiments/mcp`,
    );
    expect(await own!.json()).toEqual({
      ...(await shared.json()),
      resource: annotationEndpoint(),
    });
    expect(
      await annotationResourceMetadata(
        new Request(
          `${process.env.BETTER_AUTH_URL}${path}/api/experiments/mcp`,
        ),
      ),
    ).toBeNull();
  });

  test("each server opens only to grants for it, and one client can hold both", async () => {
    const { user, headers } = await signInAs("member");
    const forExperiments = await authorizeMcpClient(headers);
    expect(
      (await annotation(forExperiments.accessToken, "tools/list")).status,
    ).toBe(401);

    const forAnnotation = await authorizeMcpClient(headers, {
      server: "annotation",
    });
    expect(
      await toolNames(
        await annotation(forAnnotation.accessToken, "tools/list"),
      ),
    ).toEqual(USER_TOOLS);
    expect((await experiments(forAnnotation.accessToken)).status).toBe(401);
    const experimentTools = await toolNames(
      await experiments(forExperiments.accessToken),
    );
    expect(experimentTools).toContain("list-experiments");
    expect(experimentTools.some((name) => name.startsWith("annotation_"))).toBe(
      false,
    );

    const both = await authorizeMcpClient(headers, {
      server: "annotation",
      clientId: forExperiments.clientId,
    });
    expect((await annotation(both.accessToken, "tools/list")).status).toBe(200);
    expect((await experiments(forExperiments.accessToken)).status).toBe(200);
    const clients = await listMcpClients(user.id);
    expect(
      clients.find((client) => client.clientId === forExperiments.clientId)
        ?.servers,
    ).toEqual(["experiments", "annotation"]);

    for (const client of clients) await disconnectMcpClient(user.id, client.id);
    expect((await annotation(both.accessToken, "tools/list")).status).toBe(401);
    expect((await experiments(forExperiments.accessToken)).status).toBe(401);
  });

  test("a grant for one server cannot be refreshed into a token for the other", async () => {
    const { headers } = await signInAs("member");
    const { clientId, refreshToken } = await authorizeMcpClient(headers);
    expect(refreshToken).toBeDefined();
    const refreshed = await fetch(
      `${process.env.BETTER_AUTH_URL}/api/auth/oauth2/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken!,
          client_id: clientId,
          resource: annotationEndpoint(),
        }),
      },
    );
    expect(refreshed.ok).toBe(false);
    expect(((await refreshed.json()) as { error: string }).error).toBe(
      "invalid_target",
    );
  });

  test("an administrator's switch refuses people's agents but not Workers", async () => {
    const { headers } = await signInAs("member");
    const { accessToken } = await authorizeMcpClient(headers, {
      server: "annotation",
    });
    await setInteractiveAnnotation(false);
    try {
      const refused = await annotation(accessToken, "tools/list");
      expect(refused.status).toBe(403);
      expect((await rpcMessage(refused)).error?.message).toContain(
        "turned off",
      );
    } finally {
      await setInteractiveAnnotation(true);
    }
    expect(
      await toolNames(await annotation(accessToken, "tools/list")),
    ).toEqual(USER_TOOLS);
  });
});

test("people's agents and Worker agents annotate through the same annotation server", async () => {
  const { user, headers } = await signInAs("member");
  const { accessToken } = await authorizeMcpClient(headers, {
    server: "annotation",
  });
  const observed = await observeImages("mcp-annotation", ["mcp-annotation"]);
  const ref = {
    digest: observed.digests[0]!,
    modelId: observed.version.modelId,
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await annotation(accessToken, "tools/call", {
      name,
      arguments: args,
    });
    expect(response.status).toBe(200);
    return (await rpcMessage(response)).result;
  };
  const started = await call("annotation_start", { ref });
  expect(started.isError).toBeUndefined();
  const next = await call("annotation_next", { ref });
  const { taskId } = JSON.parse(next.content[0].text);
  const viewed = await call("annotation_view", { taskId });
  expect(
    viewed.content.some((item: { type: string }) => item.type === "image"),
  ).toBe(true);
  const preview = await call("annotation_preview", { taskId, instances: [] });
  expect(preview.isError).toBeUndefined();
  const { proposalId } = JSON.parse(preview.content[0].text);
  const submit = await call("annotation_submit", { taskId, proposalId });
  expect(JSON.parse(submit.content[0].text).status).toBe("succeeded");
  const read = JSON.parse(
    (await call("annotation_read", { ref })).content[0].text,
  );
  expect(read.reading).toBe("proposal");
  expect(read.review).toBeNull();
  const partial = {
    ref,
    input: "proposal",
    scope: [{ x: 0, y: 0, width: 8, height: 8 }],
  };
  const redraw = await call("annotation_start", partial);
  expect(redraw.isError).toBeUndefined();
  expect(JSON.parse(redraw.content[0].text).progress.total).toBe(1);
  expect((await call("annotation_start", partial)).isError).toBe(true);
  expect((await call("annotation_cancel", { ref })).isError).toBeUndefined();
  expect((await call("annotation_next", { ref })).isError).toBe(true);

  const heartbeat = {
    ...testHeartbeat("mcp-task-worker"),
    annotationRuntime: {
      runtime: "pi" as const,
      version: "test",
      model: "test/vision",
    },
  };
  await recordWorkerHeartbeat(heartbeat);
  const run = await createAnnotationRun(
    { ref, input: null, scope: null },
    "worker",
    user.id,
  );
  await claimAnnotationRun(heartbeat);
  const binding = await assignWorkerTask(
    run.id,
    heartbeat,
    `${run.id}/tile-000-000`,
    crypto.randomUUID(),
  );
  if (binding.accepted) throw new Error("Unexpected acceptance");
  const task = issueTaskToken(binding.principal);
  expect(await toolNames(await annotation(task, "tools/list"))).toEqual([
    "annotation_preview",
    "annotation_submit",
    "annotation_view",
  ]);
  expect((await experiments(task)).status).toBe(401);
  await setInteractiveAnnotation(false);
  try {
    const scoped = await annotation(task, "tools/call", {
      name: "annotation_view",
      arguments: { taskId: `${run.id}/tile-000-000` },
    });
    expect(
      (await rpcMessage(scoped)).result.content.some(
        (item: { type: string }) => item.type === "image",
      ),
    ).toBe(true);
  } finally {
    await setInteractiveAnnotation(true);
  }
  await cancelAnnotationRun(ref);
  expect((await annotation(task, "tools/list")).status).toBe(401);
});
