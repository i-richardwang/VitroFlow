import { expect, test } from "bun:test";

import { documentFromPrelabel } from "../annotation/prelabel";
import { makeResult } from "../annotation/testing";
import { Route as UploadRoute } from "../routes/api.datasets.$dataset.images";
import { Route as HeartbeatRoute } from "../routes/api.inference.heartbeat";
import { Route as ImageRoute } from "../routes/api.inference.images.$dataset.$stem";
import { Route as PendingRoute } from "../routes/api.inference.pending";
import { Route as PrelabelRoute } from "../routes/api.inference.prelabels.$dataset.$stem";
import { readDataset } from "./datasets";
import { readInferenceWorker } from "./inference-worker-store";
import { createLabel } from "./labels";
import { readModelVersion } from "./model-registry";
import { readPrelabel } from "./prelabels";

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

const ref = { dataset: "api", stem: "api" };

test("inference HTTP routes carry an image from upload to prelabel", async () => {
  const upload = new FormData();
  upload.append("images", new File(["image"], "api.jpg"));
  const uploadResponse = await handler(
    UploadRoute,
    "POST",
  )({
    params: { dataset: "api" },
    request: new Request("http://localhost/api/datasets/api/images", {
      method: "POST",
      body: upload,
    }),
  } as never);
  expect(uploadResponse.status).toBe(200);

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
        deployment: {
          modelVersionId: version.id,
          artifactDigest: version.artifact.digest,
        },
        runtime,
        current: ref,
      }),
    }),
  } as never);
  expect(heartbeatResponse.status).toBe(200);
  expect((await readInferenceWorker("api-worker"))?.current).toEqual(ref);

  const pendingUrl =
    "http://localhost/api/inference/pending?workerId=api-worker";
  const pendingResponse = await handler(
    PendingRoute,
    "GET",
  )({
    request: new Request(pendingUrl),
  } as never);
  expect(pendingResponse.status).toBe(200);
  expect((await pendingResponse.json()).images).toContainEqual({
    ...ref,
    source: "images/api/api.jpg",
  });
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
  )({ params: ref } as never);
  expect(imageResponse.headers.get("Content-Type")).toBe("image/jpeg");
  expect(await imageResponse.text()).toBe("image");

  const result = {
    ...makeResult([{ id: 0, x: 5, y: 5 }]),
    source: "images/api/api.jpg",
    producer: {
      model_version_id: version.id,
      artifact_digest: version.artifact.digest,
      runtime,
    },
  };
  const put = (body: unknown) =>
    handler(
      PrelabelRoute,
      "PUT",
    )({
      params: ref,
      request: new Request(
        "http://localhost/api/inference/prelabels/api/api?workerId=api-worker",
        { method: "PUT", body: JSON.stringify(body) },
      ),
    } as never);
  expect((await put({ ...result, source: "images/api/x.jpg" })).status).toBe(
    400,
  );
  expect((await put(result)).status).toBe(200);
  expect(await readPrelabel(ref)).toEqual(result);

  await createLabel(ref, documentFromPrelabel(result));
  expect((await put(result)).status).toBe(409);
});

test("an inference heartbeat cannot create an unknown model version", async () => {
  const response = await handler(
    HeartbeatRoute,
    "POST",
  )({
    request: new Request("http://localhost/api/inference/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        workerId: "unknown-version-worker",
        startedAt: "2026-01-01T00:00:00Z",
        deployment: {
          modelVersionId: "not-published",
          artifactDigest: "a".repeat(64),
        },
        runtime: { adapter: "traditional", fingerprint: "b".repeat(64) },
        current: null,
      }),
    }),
  } as never);
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("Unknown model version");
});
