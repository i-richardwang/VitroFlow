import { expect, test } from "bun:test";

import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { MAX_TRAINING_ARTIFACT_REQUEST_BYTES } from "../training/artifact";
import { Route as WeightsRoute } from "../routes/api.inference.model-versions.$versionId.weights";
import { Route as ArtifactRoute } from "../routes/api.training.runs.$runId.artifact";
import { Route as ClaimRoute } from "../routes/api.training.claim";
import { Route as EpochsRoute } from "../routes/api.training.runs.$runId.epochs";
import { Route as HeartbeatRoute } from "../routes/api.training.heartbeat";
import { Route as LeaseRoute } from "../routes/api.training.runs.$runId.lease";
import { Route as PhaseRoute } from "../routes/api.training.runs.$runId.phase";
import { Route as ReadyRoute } from "../routes/api.training.ready";
import { Route as ImageRoute } from "../routes/api.training.runs.$runId.images.$digest";
import { Route as SnapshotRoute } from "../routes/api.training.runs.$runId.snapshot";
import { contentDigest } from "./blobs";
import { reviewedDataset } from "./testing";
import { createTrainingRun } from "./training-runs";

const OWNER = { workerId: "api-trainer", sessionId: "api-trainer-session" };

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

test("training HTTP routes publish one candidate version without selecting it", async () => {
  const datasetId = "training-api";
  const { version: selected } = await reviewedDataset(datasetId, [
    "first",
    "second",
  ]);

  const created = await createTrainingRun(datasetId, YOLO26_SEED_SMALL_RECIPE);

  const heartbeat = await handler(
    HeartbeatRoute,
    "POST",
  )({
    request: new Request("http://localhost/api/training/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        ...OWNER,
        startedAt: "2026-08-27T00:00:00.000Z",
        device: "cuda:0",
        memoryBytes: 24 * 1024 ** 3,
        currentTrainingRunId: null,
      }),
    }),
  } as never);
  expect(heartbeat.status).toBe(200);

  const claim = await handler(
    ClaimRoute,
    "POST",
  )({
    request: new Request("http://localhost/api/training/claim", {
      method: "POST",
      body: JSON.stringify(OWNER),
    }),
  } as never);
  const job = await claim.json();
  expect(job.run.id).toBe(created.id);
  expect(Object.keys(job)).toEqual(["run"]);

  const snapshot = await handler(
    SnapshotRoute,
    "GET",
  )({
    params: { runId: created.id },
    request: new Request(
      `http://localhost/api/training/runs/${created.id}/snapshot?${new URLSearchParams(OWNER)}`,
    ),
  } as never);
  const snapshotImages = (await snapshot.json()).images;
  expect(snapshotImages).toHaveLength(2);
  const digest = snapshotImages[0].digest;

  const image = await handler(
    ImageRoute,
    "GET",
  )({
    params: { runId: created.id, digest },
    request: new Request(
      `http://localhost/api/training/runs/${created.id}/images/${digest}?${new URLSearchParams(OWNER)}`,
    ),
  } as never);
  expect(image.status).toBe(200);
  expect(contentDigest(new Uint8Array(await image.arrayBuffer()))).toBe(digest);

  const trainingPhase = await handler(
    PhaseRoute,
    "POST",
  )({
    params: { runId: created.id },
    request: new Request("http://localhost/phase", {
      method: "POST",
      body: JSON.stringify({ ...OWNER, phase: "training" }),
    }),
  } as never);
  expect(trainingPhase.status).toBe(200);

  const epoch = await handler(
    EpochsRoute,
    "POST",
  )({
    params: { runId: created.id },
    request: new Request("http://localhost/epochs", {
      method: "POST",
      body: JSON.stringify({
        ...OWNER,
        epoch: 1,
        train: { box: 1.2, classification: 2.4, regression: 1.1 },
        val: { box: 1.3, classification: 2.5, regression: 1.2 },
        precision: 0.5,
        recall: 0.4,
        map50: 0.45,
        map50To95: 0.2,
        fitness: 0.225,
        learningRate: 0.001,
      }),
    }),
  } as never);
  expect(epoch.status).toBe(200);
  const reported = (await epoch.json()).state;
  expect(reported.phase).toBe("training");
  expect(reported.progress).toBeCloseTo(
    0.05 + 0.85 / YOLO26_SEED_SMALL_RECIPE.parameters.epochs,
  );

  const lease = await handler(
    LeaseRoute,
    "POST",
  )({
    params: { runId: created.id },
    request: new Request("http://localhost/lease", {
      method: "POST",
      body: JSON.stringify(OWNER),
    }),
  } as never);
  expect(lease.status).toBe(200);
  expect((await lease.json()).state.progress).toBeCloseTo(reported.progress);

  const validationPhase = await handler(
    PhaseRoute,
    "POST",
  )({
    params: { runId: created.id },
    request: new Request("http://localhost/phase", {
      method: "POST",
      body: JSON.stringify({ ...OWNER, phase: "validating" }),
    }),
  } as never);
  expect(validationPhase.status).toBe(200);
  expect((await validationPhase.json()).state.progress).toBe(0.9);

  const publication = {
    schema_version: 1,
    weights: "weights/best.pt",
    inference: {
      ready: true,
      confidence: 0.42,
      imgsz: 768,
      max_det: 500,
      end2end: false,
    },
    validation: {
      precision: 0.5,
      recall: 0.4,
      map50: 0.45,
      map50_95: 0.2,
      fitness: 0.225,
    },
    training: {
      base_model: YOLO26_SEED_SMALL_RECIPE.baseModel,
      parameters: YOLO26_SEED_SMALL_RECIPE.parameters,
      runtime: YOLO26_SEED_SMALL_RECIPE.runtime,
    },
  };
  const form = new FormData();
  form.append("workerId", OWNER.workerId);
  form.append("sessionId", OWNER.sessionId);
  form.append("weights", new File(["weights"], "best.pt"));
  form.append(
    "inference",
    new File([JSON.stringify(publication)], "inference.json", {
      type: "application/json",
    }),
  );
  const artifact = await handler(
    ArtifactRoute,
    "PUT",
  )({
    params: { runId: created.id },
    request: new Request("http://localhost/artifact", {
      method: "PUT",
      headers: { "content-length": "1000" },
      body: form,
    }),
  } as never);
  expect(artifact.status).toBe(200);
  const published = await artifact.json();
  expect(published.state.status).toBe("succeeded");

  const repeated = await handler(
    ArtifactRoute,
    "PUT",
  )({
    params: { runId: created.id },
    request: new Request("http://localhost/artifact", {
      method: "PUT",
      headers: { "content-length": "1000" },
      body: form,
    }),
  } as never);
  expect(await repeated.json()).toEqual(published);
  expect(published.modelId).toBe(selected.modelId);

  const versionId = published.state.modelVersionId;
  const weights = await handler(
    WeightsRoute,
    "GET",
  )({
    params: { versionId },
  } as never);
  expect(await weights.text()).toBe("weights");
});

test("training readiness identifies the authenticated control plane", async () => {
  const response = await handler(ReadyRoute, "GET")({} as never);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ role: "training" });
});

test("training HTTP routes distinguish invalid requests from lease conflicts", async () => {
  const invalid = await handler(
    PhaseRoute,
    "POST",
  )({
    params: { runId: "train-invalid" },
    request: new Request("http://localhost/phase", {
      method: "POST",
      body: JSON.stringify({
        workerId: "trainer",
        sessionId: "trainer-session",
        phase: "complete",
      }),
    }),
  } as never);
  expect(invalid.status).toBe(400);

  const conflict = await handler(
    LeaseRoute,
    "POST",
  )({
    params: { runId: "train-missing" },
    request: new Request("http://localhost/lease", {
      method: "POST",
      body: JSON.stringify({
        workerId: "trainer",
        sessionId: "trainer-session",
      }),
    }),
  } as never);
  expect(conflict.status).toBe(409);
});

test("training artifact admission rejects unknown and excessive request sizes", async () => {
  const put = (request: Request) =>
    handler(
      ArtifactRoute,
      "PUT",
    )({ params: { runId: "train-boundary" }, request } as never);

  const unknown = await put(
    new Request("http://localhost/artifact", { method: "PUT" }),
  );
  expect(unknown.status).toBe(411);

  const excessive = await put(
    new Request("http://localhost/artifact", {
      method: "PUT",
      headers: {
        "content-length": String(MAX_TRAINING_ARTIFACT_REQUEST_BYTES + 1),
      },
      body: new Uint8Array([1]),
    }),
  );
  expect(excessive.status).toBe(413);
});
