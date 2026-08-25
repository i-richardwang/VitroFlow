import { expect, test } from "bun:test";

import { makeResult } from "../annotation/testing";
import { Route as CreateRoute } from "../routes/api.jobs";
import { Route as CompleteRoute } from "../routes/api.worker.jobs.$jobId.complete";
import { Route as ImageRoute } from "../routes/api.worker.jobs.$jobId.images.$imageId";
import { Route as ResultRoute } from "../routes/api.worker.jobs.$jobId.results.$imageId";
import { Route as ClaimRoute } from "../routes/api.worker.jobs.claim";
import { listJobs } from "./job-store";

type Handler = (context: never) => Response | Promise<Response>;

function handler(route: typeof ClaimRoute, method: "POST"): Handler;
function handler(route: typeof CreateRoute, method: "POST"): Handler;
function handler(route: typeof CompleteRoute, method: "POST"): Handler;
function handler(route: typeof ImageRoute, method: "GET"): Handler;
function handler(route: typeof ResultRoute, method: "PUT"): Handler;
function handler(
  route:
    | typeof ClaimRoute
    | typeof CreateRoute
    | typeof CompleteRoute
    | typeof ImageRoute
    | typeof ResultRoute,
  method: "GET" | "POST" | "PUT",
): Handler {
  const handlers = route.options.server?.handlers as
    | Partial<Record<"GET" | "POST" | "PUT", Handler>>
    | undefined;
  const selected = handlers?.[method];
  if (!selected) {
    throw new Error(`Missing ${method} route handler`);
  }
  return selected as Handler;
}

test("worker HTTP routes implement the recognition lifecycle", async () => {
  const upload = new FormData();
  upload.set("dataset", "api");
  upload.set("runId", "api-run");
  upload.append("images", new File(["image"], "api.jpg"));
  const createResponse = await handler(CreateRoute, "POST")({
    request: new Request("http://localhost/api/jobs", {
      method: "POST",
      body: upload,
    }),
  } as never);
  expect(createResponse.status).toBe(303);

  const job = listJobs().find((candidate) => candidate.runId === "api-run");
  if (!job) {
    throw new Error("Job route did not create a job");
  }
  const claimResponse = await handler(ClaimRoute, "POST")({} as never);
  expect(claimResponse.status).toBe(200);
  expect((await claimResponse.json()).id).toBe(job.id);

  const imageResponse = await handler(ImageRoute, "GET")({
    params: { jobId: job.id, imageId: job.images[0].id },
  } as never);
  expect(await imageResponse.text()).toBe("image");

  const result = makeResult([]);
  result.source = job.images[0].source;
  const artifacts = new FormData();
  artifacts.set("result", new File([JSON.stringify(result)], "result.json"));
  artifacts.set("overlay", new File(["overlay"], "overlay.jpg"));
  artifacts.set("debug", new File(["debug"], "debug.jpg"));
  const resultResponse = await handler(ResultRoute, "PUT")({
    params: { jobId: job.id, imageId: job.images[0].id },
    request: new Request("http://localhost/result", {
      method: "PUT",
      body: artifacts,
    }),
  } as never);
  expect(resultResponse.status).toBe(200);

  const completeResponse = await handler(CompleteRoute, "POST")({
    params: { jobId: job.id },
  } as never);
  expect(completeResponse.status).toBe(200);
  expect((await completeResponse.json()).status).toBe("succeeded");
});
