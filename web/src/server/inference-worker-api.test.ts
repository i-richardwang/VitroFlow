import { expect, test } from "bun:test";

import { documentFromDetection } from "../annotation/detection";
import { makeResult } from "../annotation/testing";
import { inferenceAssignmentSchema } from "../inference/assignments";
import { Route as ClaimRoute } from "../routes/api.datasets.$dataset.images";
import { Route as StoreRoute } from "../routes/api.images";
import { Route as HeartbeatRoute } from "../routes/api.inference.heartbeat";
import { Route as ReadyRoute } from "../routes/api.inference.ready";
import { Route as ImageRoute } from "../routes/api.inference.images.$digest";
import { Route as PendingRoute } from "../routes/api.inference.pending";
import { Route as ResultRoute } from "../routes/api.inference.results.$versionId.$digest";
import { readDataset } from "./datasets";
import { readInferenceWorker } from "./inference-worker-store";
import { createLabel } from "./labels";
import { readModelVersion } from "./model-registry";
import { readDetection } from "./detections";
import { contentDigest } from "./blobs";
import { FIXTURE_EDGE, imageBytes, imageDigest } from "./testing";

type Handler = (context: never) => Response | Promise<Response>;

function handler(
  route: { options: { server?: { handlers?: unknown } } },
  method: "GET" | "POST" | "PUT",
): Handler {
  const handlers = route.options.server?.handlers as
    Partial<Record<"GET" | "POST" | "PUT", Handler>> | undefined;
  const selected = handlers?.[method];
  if (!selected) throw new Error(`Missing ${method} route handler`);
  return selected;
}

const digest = await imageDigest("image");
const ref = { dataset: "api", digest };

test("inference HTTP routes carry an image from upload to detection", async () => {
  const upload = await imageBytes("image");
  const stored = await handler(
    StoreRoute,
    "POST",
  )({
    request: new Request("http://localhost/api/images", {
      method: "POST",
      headers: { "content-length": String(upload.byteLength) },
      body: upload,
    }),
  } as never);
  expect(stored.status).toBe(200);
  expect(await stored.json()).toMatchObject({ digest });

  const claimed = await handler(
    ClaimRoute,
    "POST",
  )({
    params: { dataset: "api" },
    request: new Request("http://localhost/api/datasets/api/images", {
      method: "POST",
      body: JSON.stringify({ images: [{ digest, filename: "api.jpg" }] }),
    }),
  } as never);
  expect(claimed.status).toBe(200);
  expect(await claimed.json()).toEqual({ added: 1, existing: 0 });

  const dataset = await readDataset("api");
  if (!dataset) throw new Error("missing dataset");
  const version = await readModelVersion(dataset.selectedModelVersionId);
  if (!version) throw new Error("missing model version");
  const runtime = {
    adapter: "traditional" as const,
    fingerprint: "b".repeat(64),
  };
  const heartbeatResponse = await handler(
    HeartbeatRoute,
    "POST",
  )({
    request: new Request("http://localhost/api/inference/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        workerId: "api-worker",
        startedAt: "2026-01-01T00:00:00Z",
        runtimes: [runtime],
        loaded: null,
        current: digest,
      }),
    }),
  } as never);
  expect(heartbeatResponse.status).toBe(200);
  expect((await readInferenceWorker("api-worker"))?.current).toBe(digest);

  const pendingUrl =
    "http://localhost/api/inference/pending?workerId=api-worker";
  const pendingResponse = await handler(
    PendingRoute,
    "GET",
  )({
    request: new Request(pendingUrl),
  } as never);
  expect(pendingResponse.status).toBe(200);
  const { assignments } = await pendingResponse.json();
  const rawAssignment = assignments.find(
    (entry: { manifest: { modelVersionId: string } }) =>
      entry.manifest.modelVersionId === version.id,
  );
  const assignment = inferenceAssignmentSchema.parse(rawAssignment);
  expect(assignment.manifest).toEqual({
    schemaVersion: 1,
    modelVersionId: version.id,
    artifact: version.artifact,
  });
  expect(assignment.images).toContain(digest);
  expect(
    (
      await handler(
        PendingRoute,
        "GET",
      )({
        request: new Request("http://localhost/api/inference/pending"),
      } as never)
    ).status,
  ).toBe(400);

  const imageResponse = await handler(
    ImageRoute,
    "GET",
  )({ params: { digest } } as never);
  expect(imageResponse.headers.get("Content-Type")).toBe("image/avif");
  expect(imageResponse.headers.get("Cache-Control")).toContain("immutable");
  expect(contentDigest(new Uint8Array(await imageResponse.arrayBuffer()))).toBe(
    digest,
  );

  const result = {
    ...makeResult([{ id: 0, x: 5, y: 5 }], {
      digest,
      dishRadius: FIXTURE_EDGE / 4,
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
    }),
    producer: {
      model_version_id: version.id,
      artifact_digest: version.artifact.digest,
      runtime,
    },
  };
  const target = { versionId: version.id, digest };
  const put = (body: unknown, workerId = "api-worker") =>
    handler(
      ResultRoute,
      "PUT",
    )({
      params: target,
      request: new Request(
        `http://localhost/api/inference/results/${version.id}/${digest}?workerId=${workerId}`,
        { method: "PUT", body: JSON.stringify(body) },
      ),
    } as never);
  expect((await put(result, "unknown-worker")).status).toBe(409);
  expect(
    (
      await put({
        ...result,
        image: { ...result.image, digest: "0".repeat(64) },
      })
    ).status,
  ).toBe(400);
  const missingDigest = "f".repeat(64);
  const missing = await handler(
    ResultRoute,
    "PUT",
  )({
    params: { versionId: version.id, digest: missingDigest },
    request: new Request(
      `http://localhost/api/inference/results/${version.id}/${missingDigest}?workerId=api-worker`,
      {
        method: "PUT",
        body: JSON.stringify({
          ...result,
          image: { ...result.image, digest: missingDigest },
        }),
      },
    ),
  } as never);
  expect(missing.status).toBe(404);
  expect(
    (
      await put({
        ...result,
        producer: { ...result.producer, artifact_digest: "d".repeat(64) },
      })
    ).status,
  ).toBe(422);
  expect((await put(result)).status).toBe(200);
  expect(await readDetection(target)).toEqual(result);
  expect((await put(result)).status).toBe(200);
  expect(
    (
      await put({
        ...result,
        quality: { status: "review_required", warnings: [] },
      })
    ).status,
  ).toBe(409);

  await createLabel(ref, documentFromDetection(result));
  expect((await put(result)).status).toBe(200);
});

test("an inference heartbeat cannot load an unknown model version", async () => {
  const response = await handler(
    HeartbeatRoute,
    "POST",
  )({
    request: new Request("http://localhost/api/inference/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        workerId: "unknown-version-worker",
        startedAt: "2026-01-01T00:00:00Z",
        runtimes: [{ adapter: "traditional", fingerprint: "b".repeat(64) }],
        loaded: "not-published",
        current: null,
      }),
    }),
  } as never);
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("Unknown model version");
});

test("inference readiness identifies the authenticated control plane", async () => {
  const response = await handler(ReadyRoute, "GET")({} as never);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ role: "inference" });
});

test("storing an image rejects an absent or excessive declared body before reading it", async () => {
  const post = (request: Request) =>
    handler(StoreRoute, "POST")({ request } as never);

  const absent = await post(
    new Request("http://localhost/api/images", { method: "POST" }),
  );
  expect(absent.status).toBe(411);

  const excessive = await post(
    new Request("http://localhost/api/images", {
      method: "POST",
      headers: { "content-length": String(64 * 1024 * 1024 + 1) },
      body: new Uint8Array([1]),
    }),
  );
  expect(excessive.status).toBe(413);
});

test("image claims distinguish invalid requests from expired stored images", async () => {
  const post = (body: string) =>
    handler(
      ClaimRoute,
      "POST",
    )({
      params: { dataset: "claim-boundary" },
      request: new Request(
        "http://localhost/api/datasets/claim-boundary/images",
        { method: "POST", body },
      ),
    } as never);

  expect((await post("not json")).status).toBe(400);
  const nonObject = await post(JSON.stringify([]));
  expect(nonObject.status).toBe(400);
  expect(await nonObject.json()).toEqual({
    error: "Request body must be a JSON object",
  });
  expect((await post(JSON.stringify({ images: [] }))).status).toBe(400);
  expect(
    (
      await post(
        JSON.stringify({
          images: [{ digest: "a".repeat(64), filename: "a.jpg" }],
        }),
      )
    ).status,
  ).toBe(409);
});
