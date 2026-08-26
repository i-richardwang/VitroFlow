import { expect, test } from "bun:test";

import { makeResult } from "../annotation/testing";
import { Route as CreateRoute } from "../routes/api.jobs";
import { Route as CompleteRoute } from "../routes/api.worker.jobs.$jobId.complete";
import { Route as ImageRoute } from "../routes/api.worker.jobs.$jobId.images.$imageId";
import { Route as ResultRoute } from "../routes/api.worker.jobs.$jobId.results.$imageId";
import { Route as ClaimRoute } from "../routes/api.worker.jobs.claim";
import { Route as HeartbeatRoute } from "../routes/api.worker.heartbeat";
import { listJobs } from "./job-store";
import { readWorker } from "./worker-store";

type Handler = (context: never) => Response | Promise<Response>;

function handler(route: typeof ClaimRoute, method: "POST"): Handler;
function handler(route: typeof HeartbeatRoute, method: "POST"): Handler;
function handler(route: typeof CreateRoute, method: "POST"): Handler;
function handler(route: typeof CompleteRoute, method: "POST"): Handler;
function handler(route: typeof ImageRoute, method: "GET"): Handler;
function handler(route: typeof ResultRoute, method: "PUT"): Handler;
function handler(
  route:
    | typeof ClaimRoute
    | typeof HeartbeatRoute
    | typeof CreateRoute
    | typeof CompleteRoute
    | typeof ImageRoute
    | typeof ResultRoute,
  method: "GET" | "POST" | "PUT",
): Handler {
  const handlers = route.options.server?.handlers as
    Partial<Record<"GET" | "POST" | "PUT", Handler>> | undefined;
  const selected = handlers?.[method];
  if (!selected) {
    throw new Error(`Missing ${method} route handler`);
  }
  return selected as Handler;
}

test("worker HTTP routes implement the recognition lifecycle", async () => {
  const upload = new FormData();
  upload.set("dataset", "api");
  upload.append("images", new File(["image"], "api.jpg"));
  const createResponse = await handler(
    CreateRoute,
    "POST",
  )({
    request: new Request("http://localhost/api/jobs", {
      method: "POST",
      body: upload,
    }),
  } as never);
  expect(createResponse.status).toBe(200);
  const createdId = (await createResponse.json()).created as string;

  const job = listJobs().find((candidate) => candidate.id === createdId);
  if (!job) {
    throw new Error("Job route did not create a job");
  }
  const { pipeline, model, config } = makeResult([]);
  const heartbeatResponse = await handler(
    HeartbeatRoute,
    "POST",
  )({
    request: new Request("http://localhost/api/worker/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        workerId: "api-worker",
        startedAt: "2026-01-01T00:00:00Z",
        execution: { pipeline, model, config },
        currentJobId: null,
      }),
    }),
  } as never);
  expect(heartbeatResponse.status).toBe(200);
  expect(readWorker("api-worker")?.workerId).toBe("api-worker");

  const claimResponse = await handler(
    ClaimRoute,
    "POST",
  )({
    request: new Request("http://localhost/api/worker/jobs/claim", {
      method: "POST",
      body: JSON.stringify({ workerId: "api-worker" }),
    }),
  } as never);
  expect(claimResponse.status).toBe(200);
  const claim = await claimResponse.json();
  expect(claim.id).toBe(job.id);
  expect(claim.completedImageIds).toEqual([]);

  const imageResponse = await handler(
    ImageRoute,
    "GET",
  )({
    params: { jobId: job.id, imageId: job.images[0].id },
  } as never);
  expect(await imageResponse.text()).toBe("image");

  const result = makeResult([]);
  result.source = job.images[0].source;
  const artifacts = new FormData();
  artifacts.set("result", new File([JSON.stringify(result)], "result.json"));
  artifacts.set("overlay", new File(["overlay"], "overlay.jpg"));
  artifacts.set("debug", new File(["debug"], "debug.jpg"));
  const resultResponse = await handler(
    ResultRoute,
    "PUT",
  )({
    params: { jobId: job.id, imageId: job.images[0].id },
    request: new Request("http://localhost/result", {
      method: "PUT",
      body: artifacts,
    }),
  } as never);
  expect(resultResponse.status).toBe(200);

  const completeResponse = await handler(
    CompleteRoute,
    "POST",
  )({
    params: { jobId: job.id },
  } as never);
  expect(completeResponse.status).toBe(200);
  expect((await completeResponse.json()).status).toBe("succeeded");
});
