import { expect, test } from "bun:test";

import { makeResult } from "../annotation/testing";
import { inferenceAssignmentSchema } from "../inference/assignments";
import { Route as StoreRoute } from "../routes/api.images";
import { Route as HeartbeatRoute } from "../routes/api.inference.heartbeat";
import { Route as ReadyRoute } from "../routes/api.inference.ready";
import { Route as ImageRoute } from "../routes/api.inference.images.$digest";
import { Route as PendingRoute } from "../routes/api.inference.pending";
import { Route as ResultRoute } from "../routes/api.inference.results.$versionId.$digest";
import { readInferenceWorker } from "./inference-worker-store";
import { createAnnotationFromDetection } from "./annotations";
import {
  addObservationUnits,
  addTreatment,
  createExperiment,
} from "./experiment-design";
import { assignObservationImages } from "./experiment-observation-images";
import { addObservation } from "./experiment-observations";
import { readDetection } from "./inference-outcomes";
import { contentDigest } from "./blobs";
import {
  FIXTURE_EDGE,
  baselineVersion,
  imageBytes,
  imageDigest,
} from "./testing";

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

  const version = await baselineVersion();
  const experiment = await createExperiment({
    name: "API",
    plantMaterial: "",
    explantType: "",
    baseMedium: "",
    notes: "",
    inoculatedOn: "2026-08-01",
    modelVersionId: version.id,
  });
  const treatment = await addTreatment({
    experiment: experiment.id,
    name: "Test",
    factors: [],
    note: "",
    replicates: 0,
    initialExplantCount: 1,
  });
  const [observationUnit] = await addObservationUnits({
    experiment: experiment.id,
    treatment: treatment.id,
    codes: ["A1"],
    initialExplantCount: 1,
  });
  const observation = await addObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
  });
  await assignObservationImages({
    experiment: experiment.id,
    observation: observation.id,
    images: [
      { observationUnit: observationUnit!.id, digest, filename: "api.jpg" },
    ],
  });
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
    classes: ["seed"],
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
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
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
  const rawPut = (params: typeof target, body: string) =>
    handler(
      ResultRoute,
      "PUT",
    )({
      params,
      request: new Request(
        `http://localhost/api/inference/results/${params.versionId}/${params.digest}?workerId=api-worker`,
        { method: "PUT", body },
      ),
    } as never);
  expect((await rawPut(target, "not json")).status).toBe(400);
  expect(
    (
      await rawPut(
        { versionId: "not a version", digest },
        JSON.stringify(result),
      )
    ).status,
  ).toBe(400);
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
        producer: { ...result.producer, artifactDigest: "d".repeat(64) },
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

  await createAnnotationFromDetection(
    { digest, modelId: version.modelId },
    version.id,
  );
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
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({
    error: "Unknown model version: not-published",
  });
});

test("inference readiness identifies the authenticated control plane", async () => {
  const response = await handler(ReadyRoute, "GET")({} as never);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ role: "inference" });
});

test("storing an image rejects an absent or excessive body before reading it", async () => {
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
