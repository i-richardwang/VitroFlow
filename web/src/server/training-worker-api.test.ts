import { expect, test } from "bun:test";

import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { Route as ManifestRoute } from "../routes/api.inference.model-versions.$versionId";
import { Route as WeightsRoute } from "../routes/api.inference.model-versions.$versionId.weights";
import { Route as ArtifactRoute } from "../routes/api.training.runs.$runId.artifact";
import { Route as ClaimRoute } from "../routes/api.training.claim";
import { Route as HeartbeatRoute } from "../routes/api.training.heartbeat";
import { Route as ImageRoute } from "../routes/api.training.runs.$runId.images.$digest";
import { Route as ProgressRoute } from "../routes/api.training.runs.$runId.progress";
import { Route as SnapshotRoute } from "../routes/api.training.runs.$runId.snapshot";
import { contentDigest } from "./blobs";
import { readDataset } from "./datasets";
import { reviewedDataset } from "./testing";
import { createTrainingRun } from "./training-runs";

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
        workerId: "api-trainer",
        startedAt: "2026-08-27T00:00:00.000Z",
        device: "cuda:0",
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
      body: JSON.stringify({ workerId: "api-trainer" }),
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
      `http://localhost/api/training/runs/${created.id}/snapshot?workerId=api-trainer`,
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
      `http://localhost/api/training/runs/${created.id}/images/${digest}?workerId=api-trainer`,
    ),
  } as never);
  expect(image.status).toBe(200);
  expect(contentDigest(new Uint8Array(await image.arrayBuffer()))).toBe(digest);

  const progress = await handler(
    ProgressRoute,
    "POST",
  )({
    params: { runId: created.id },
    request: new Request("http://localhost/progress", {
      method: "POST",
      body: JSON.stringify({
        workerId: "api-trainer",
        phase: "validating",
        progress: 0.95,
      }),
    }),
  } as never);
  expect(progress.status).toBe(200);

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
    validation: { "metrics/mAP50(B)": 0.8 },
    training: {
      base_model: YOLO26_SEED_SMALL_RECIPE.baseModel,
      configuration: YOLO26_SEED_SMALL_RECIPE.configuration,
      runtime: YOLO26_SEED_SMALL_RECIPE.runtime,
    },
  };
  const form = new FormData();
  form.append("workerId", "api-trainer");
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
      body: form,
    }),
  } as never);
  expect(await repeated.json()).toEqual(published);
  expect((await readDataset(datasetId))?.selectedModelVersionId).toBe(
    selected.id,
  );

  const versionId = published.state.modelVersionId;
  const manifest = await handler(
    ManifestRoute,
    "GET",
  )({
    params: { versionId },
  } as never);
  expect((await manifest.json()).id).toBe(versionId);
  const weights = await handler(
    WeightsRoute,
    "GET",
  )({
    params: { versionId },
  } as never);
  expect(await weights.text()).toBe("weights");
});
