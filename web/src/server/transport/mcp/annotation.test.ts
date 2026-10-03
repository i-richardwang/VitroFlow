import { describe, expect, test } from "bun:test";

import { issueTaskToken } from "./task-credentials";
import { serveAnnotationMcp } from "./annotation";
import { serveExperimentsMcp } from "./experiments";
import { annotationResourceMetadata } from "./access";
import { disconnectMcpClient, listMcpClients } from "../../auth/mcp-clients";
import {
  authorizeMcpClient,
  observeImages,
  recordTestHeartbeat,
  signInAs,
  testHeartbeat,
} from "../../testing/fixtures";
import { legacyRequest, requestEras, rpcMessage } from "../../testing/mcp";
import {
  createAnnotationRun,
  claimAnnotationRun,
  assignWorkerTask,
  cancelAnnotationRun,
} from "../../annotation-runs/public";

const annotationEndpoint = () =>
  `${process.env.BETTER_AUTH_URL}/api/annotation/mcp`;
const experimentsEndpoint = () =>
  `${process.env.BETTER_AUTH_URL}/api/experiments/mcp`;

async function toolNames(response: Response): Promise<string[]> {
  expect(response.status).toBe(200);
  return (await rpcMessage(response)).result.tools
    .map((tool: { name: string }) => tool.name)
    .sort();
}

const USER_TOOLS = [
  "annotation_cancel",
  "annotation_context",
  "annotation_next",
  "annotation_preview",
  "annotation_read",
  "annotation_start",
  "annotation_submit",
  "annotation_view",
];

describe.each(requestEras)(
  "annotation MCP authorization (%s)",
  (era, request) => {
    const annotation = (
      token: string,
      method: string,
      params?: Record<string, unknown>,
    ) =>
      serveAnnotationMcp(request(annotationEndpoint(), method, params, token));
    const experiments = (token: string) =>
      serveExperimentsMcp(
        request(experimentsEndpoint(), "tools/list", undefined, token),
      );
    test("tool hints warn that cancellation discards progress and submission is idempotent", async () => {
      const { headers } = await signInAs("member");
      const { accessToken } = await authorizeMcpClient(headers, {
        server: "annotation",
      });
      const response = await annotation(accessToken, "tools/list");
      expect(response.status).toBe(200);
      const { tools } = (await rpcMessage(response)).result;
      const tool = (name: string) =>
        tools.find((item: { name: string }) => item.name === name);
      expect(tool("annotation_cancel").annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
      expect(tool("annotation_submit").annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      });
      expect(tool("annotation_read").annotations.readOnlyHint).toBe(true);
      expect(tool("annotation_context").annotations.readOnlyHint).toBe(true);
      expect(tool("annotation_view").annotations.readOnlyHint).toBe(true);
    });

    test("a request without a token is challenged toward the annotation resource metadata", async () => {
      const response = await serveAnnotationMcp(
        request(annotationEndpoint(), "tools/list"),
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
      expect(
        experimentTools.some((name) => name.startsWith("annotation_")),
      ).toBe(false);

      const both = await authorizeMcpClient(headers, {
        server: "annotation",
        clientId: forExperiments.clientId,
      });
      expect((await annotation(both.accessToken, "tools/list")).status).toBe(
        200,
      );
      expect((await experiments(forExperiments.accessToken)).status).toBe(200);
      const clients = await listMcpClients(user.id);
      expect(
        clients.find((client) => client.clientId === forExperiments.clientId)
          ?.servers,
      ).toEqual(["experiments", "annotation"]);

      for (const client of clients)
        await disconnectMcpClient(user.id, client.id);
      expect((await annotation(both.accessToken, "tools/list")).status).toBe(
        401,
      );
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

    test("people's agents and Worker agents annotate through the same annotation server", async () => {
      const { user, headers } = await signInAs("member");
      const { accessToken } = await authorizeMcpClient(headers, {
        server: "annotation",
      });
      if (request === legacyRequest) {
        const response = await annotation(accessToken, "initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "annotation-compatibility-test", version: "1" },
        });
        expect(response.status).toBe(200);
        expect(response.headers.has("mcp-session-id")).toBe(false);
        expect((await rpcMessage(response)).result.protocolVersion).toBe(
          "2025-06-18",
        );
        expect(
          (await annotation(accessToken, "notifications/initialized")).status,
        ).toBe(202);
      }
      const observed = await observeImages(`mcp-annotation-${era}`, [
        `mcp-annotation-${era}`,
      ]);
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
      const context = await call("annotation_context", { taskId });
      expect(
        context.content.filter(
          (item: { type: string }) => item.type === "image",
        ),
      ).toHaveLength(1);
      const viewed = await call("annotation_view", { taskId });
      expect(JSON.parse(viewed.content[0].text).contextId).toBe(
        JSON.parse(context.content[0].text).contextId,
      );
      expect(
        viewed.content.filter(
          (item: { type: string }) => item.type === "image",
        ),
      ).toHaveLength(1);
      expect(
        viewed.content.some((item: { type: string }) => item.type === "image"),
      ).toBe(true);
      const preview = await call("annotation_preview", {
        taskId,
        instances: [],
      });
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
      expect(
        (await call("annotation_cancel", { ref })).isError,
      ).toBeUndefined();
      expect((await call("annotation_next", { ref })).isError).toBe(true);

      const heartbeat = {
        ...testHeartbeat(`mcp-task-worker-${era}`),
        annotationRuntime: {
          runtime: "pi" as const,
          version: "test",
          model: "test/vision",
        },
      };
      await recordTestHeartbeat(heartbeat);
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
      for (const method of ["GET", "DELETE"]) {
        const response = await serveAnnotationMcp(
          new Request(annotationEndpoint(), {
            method,
            headers: {
              host: new URL(annotationEndpoint()).host,
              authorization: `Bearer ${task}`,
            },
          }),
        );
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("POST");
      }
      expect(await toolNames(await annotation(task, "tools/list"))).toEqual([
        "annotation_context",
        "annotation_preview",
        "annotation_submit",
        "annotation_view",
      ]);
      // A request from a Worker must not change the next user's tool catalog.
      expect(
        await toolNames(await annotation(accessToken, "tools/list")),
      ).toEqual(USER_TOOLS);
      const wrongTask = await annotation(task, "tools/call", {
        name: "annotation_context",
        arguments: { taskId: "another-run/tile-000-000" },
      });
      expect((await rpcMessage(wrongTask)).result.isError).toBe(true);
      expect((await experiments(task)).status).toBe(401);
      await cancelAnnotationRun(ref);
      expect((await annotation(task, "tools/list")).status).toBe(401);
    });
  },
);
