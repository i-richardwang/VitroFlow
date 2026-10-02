import { expect, test } from "bun:test";

import { YOLO26_SEED_SMALL_RECIPE } from "../../../domain/training/recipes";
import { MAX_TRAINING_ARTIFACT_REQUEST_BYTES } from "../../../domain/training/artifact";
import { trainingRunSchema } from "../../../domain/training/schema";
import { Route as HeartbeatRoute } from "../../../routes/api.worker.heartbeat";
import { Route as WeightsRoute } from "../../../routes/api.worker.inference.model-versions.$versionId.weights";
import { Route as ClaimRoute } from "../../../routes/api.worker.training.claim";
import { Route as ArtifactRoute } from "../../../routes/api.worker.training.runs.$runId.artifact";
import { Route as EpochsRoute } from "../../../routes/api.worker.training.runs.$runId.epochs";
import { Route as ImageRoute } from "../../../routes/api.worker.training.runs.$runId.images.$digest";
import { Route as LeaseRoute } from "../../../routes/api.worker.training.runs.$runId.lease";
import { Route as PhaseRoute } from "../../../routes/api.worker.training.runs.$runId.phase";
import { Route as SnapshotRoute } from "../../../routes/api.worker.training.runs.$runId.snapshot";
import { contentDigest } from "../../infra/digest";
import { ULTRALYTICS_RUNTIME, reviewedDataset } from "../../testing/fixtures";
import { createTrainingRun } from "../../training/runs";
import { enrollWorker } from "../../workers/public";
import { workerRoute } from "./testing";

const SESSION = { sessionId: "api-trainer-session" };

test("the shared training claim fixture is the Web training contract", async () => {
  const fixture = await Bun.file(
    new URL(
      "../../../../../tests/fixtures/contracts/training-claim.json",
      import.meta.url,
    ),
  ).json();
  expect(trainingRunSchema.parse(fixture.run)).toEqual(fixture.run);
});

test("training HTTP routes publish a version and serve its weights idempotently", async () => {
  const datasetId = "training-api";
  const { version: sourceVersion } = await reviewedDataset(datasetId, [
    "first",
    "second",
  ]);

  const created = await createTrainingRun(datasetId, YOLO26_SEED_SMALL_RECIPE);
  const { token } = await enrollWorker("api-trainer");
  const authorization = `Bearer ${token}`;

  const heartbeat = await workerRoute(
    HeartbeatRoute,
    "POST",
  )({
    request: new Request("http://localhost/api/worker/heartbeat", {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify({
        ...SESSION,
        startedAt: "2026-08-27T00:00:00.000Z",
        runtimes: [ULTRALYTICS_RUNTIME],
        annotationRuntime: null,
        memoryBytes: 24 * 1024 ** 3,
      }),
    }),
  } as never);
  expect(heartbeat.status).toBe(200);

  const claim = await workerRoute(
    ClaimRoute,
    "POST",
  )({
    request: new Request("http://localhost/api/worker/training/claim", {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify(SESSION),
    }),
  } as never);
  const job = await claim.json();
  expect(job.run.id).toBe(created.id);
  expect(Object.keys(job)).toEqual(["run"]);

  const snapshot = await workerRoute(
    SnapshotRoute,
    "GET",
  )({
    params: { runId: created.id },
    request: new Request(
      `http://localhost/api/worker/training/runs/${created.id}/snapshot?${new URLSearchParams(SESSION)}`,
      { headers: { authorization } },
    ),
  } as never);
  const snapshotImages = (await snapshot.json()).images;
  expect(snapshotImages).toHaveLength(2);
  const digest = snapshotImages[0].digest;

  const image = await workerRoute(
    ImageRoute,
    "GET",
  )({
    params: { runId: created.id, digest },
    request: new Request(
      `http://localhost/api/worker/training/runs/${created.id}/images/${digest}?${new URLSearchParams(SESSION)}`,
      { headers: { authorization } },
    ),
  } as never);
  expect(image.status).toBe(200);
  expect(contentDigest(new Uint8Array(await image.arrayBuffer()))).toBe(digest);

  const trainingPhase = await workerRoute(
    PhaseRoute,
    "POST",
  )({
    params: { runId: created.id },
    request: new Request("http://localhost/phase", {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify({ ...SESSION, phase: "training" }),
    }),
  } as never);
  expect(trainingPhase.status).toBe(200);

  const epoch = await workerRoute(
    EpochsRoute,
    "POST",
  )({
    params: { runId: created.id },
    request: new Request("http://localhost/epochs", {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify({
        ...SESSION,
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

  const lease = await workerRoute(
    LeaseRoute,
    "POST",
  )({
    params: { runId: created.id },
    request: new Request("http://localhost/lease", {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify(SESSION),
    }),
  } as never);
  expect(lease.status).toBe(200);
  expect((await lease.json()).state.progress).toBeCloseTo(reported.progress);

  const validationPhase = await workerRoute(
    PhaseRoute,
    "POST",
  )({
    params: { runId: created.id },
    request: new Request("http://localhost/phase", {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify({ ...SESSION, phase: "validating" }),
    }),
  } as never);
  expect(validationPhase.status).toBe(200);
  expect((await validationPhase.json()).state.progress).toBe(0.9);

  const publication = {
    schemaVersion: 1,
    weights: "weights/best.pt",
    inference: {
      ready: true,
      confidence: 0.42,
      imageSize: 768,
      maxDetections: 500,
      endToEnd: false,
    },
    validation: {
      precision: 0.5,
      recall: 0.4,
      map50: 0.45,
      map50To95: 0.2,
      fitness: 0.225,
    },
    training: {
      baseModel: YOLO26_SEED_SMALL_RECIPE.baseModel,
      parameters: YOLO26_SEED_SMALL_RECIPE.parameters,
      runtime: YOLO26_SEED_SMALL_RECIPE.runtime,
    },
  };
  const form = new FormData();
  form.append("sessionId", SESSION.sessionId);
  form.append("weights", new File(["weights"], "best.pt"));
  form.append(
    "inference",
    new File([JSON.stringify(publication)], "inference.json", {
      type: "application/json",
    }),
  );
  const artifact = await workerRoute(
    ArtifactRoute,
    "PUT",
  )({
    params: { runId: created.id },
    request: new Request("http://localhost/artifact", {
      method: "PUT",
      headers: { authorization, "content-length": "1000" },
      body: form,
    }),
  } as never);
  expect(artifact.status).toBe(200);
  const published = await artifact.json();
  expect(published.state.status).toBe("succeeded");

  const repeated = await workerRoute(
    ArtifactRoute,
    "PUT",
  )({
    params: { runId: created.id },
    request: new Request("http://localhost/artifact", {
      method: "PUT",
      headers: { authorization, "content-length": "1000" },
      body: form,
    }),
  } as never);
  expect(await repeated.json()).toEqual(published);
  expect(published.modelId).toBe(sourceVersion.modelId);

  const versionId = published.state.modelVersionId;
  const weights = await workerRoute(
    WeightsRoute,
    "GET",
  )({
    params: { versionId },
    request: new Request("http://localhost/weights", {
      headers: { authorization },
    }),
  });
  expect(await weights.text()).toBe("weights");
});

test("training HTTP routes distinguish invalid requests from lease conflicts", async () => {
  const { token } = await enrollWorker("api-conflict-trainer");
  const authorization = `Bearer ${token}`;
  const invalid = await workerRoute(
    PhaseRoute,
    "POST",
  )({
    params: { runId: "train-invalid" },
    request: new Request("http://localhost/phase", {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify({
        sessionId: "trainer-session",
        phase: "complete",
      }),
    }),
  } as never);
  expect(invalid.status).toBe(400);

  const conflict = await workerRoute(
    LeaseRoute,
    "POST",
  )({
    params: { runId: "train-missing" },
    request: new Request("http://localhost/lease", {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify({ sessionId: "trainer-session" }),
    }),
  } as never);
  expect(conflict.status).toBe(409);
});

test("training artifact admission rejects unknown and excessive request sizes", async () => {
  const { token } = await enrollWorker("api-boundary-trainer");
  const authorization = `Bearer ${token}`;
  const put = (request: Request) =>
    workerRoute(
      ArtifactRoute,
      "PUT",
    )({ params: { runId: "train-boundary" }, request } as never);

  const unknown = await put(
    new Request("http://localhost/artifact", {
      method: "PUT",
      headers: { authorization },
    }),
  );
  expect(unknown.status).toBe(411);

  const excessive = await put(
    new Request("http://localhost/artifact", {
      method: "PUT",
      headers: {
        authorization,
        "content-length": String(MAX_TRAINING_ARTIFACT_REQUEST_BYTES + 1),
      },
      body: new Uint8Array([1]),
    }),
  );
  expect(excessive.status).toBe(413);
});
