import { expect, test } from "bun:test";

import { makeResult } from "../annotation/testing";
import { Route as UploadRoute } from "../routes/api.datasets.$dataset.images";
import { Route as HeartbeatRoute } from "../routes/api.worker.heartbeat";
import { Route as ImageRoute } from "../routes/api.worker.images.$dataset.$stem";
import { Route as PendingRoute } from "../routes/api.worker.pending";
import { Route as PrelabelRoute } from "../routes/api.worker.prelabels.$dataset.$stem";
import { documentFromPrelabel } from "../annotation/prelabel";
import { createLabel } from "./labels";
import { readPrelabel } from "./prelabels";
import { readWorker } from "./worker-store";

type Handler = (context: never) => Response | Promise<Response>;

function handler(
  route: { options: { server?: { handlers?: unknown } } },
  method: "GET" | "POST" | "PUT",
): Handler {
  const handlers = route.options.server?.handlers as
    Partial<Record<"GET" | "POST" | "PUT", Handler>> | undefined;
  const selected = handlers?.[method];
  if (!selected) {
    throw new Error(`Missing ${method} route handler`);
  }
  return selected;
}

const { producer } = makeResult([]);
const ref = { dataset: "api", stem: "api" };

test("worker HTTP routes carry an image from upload to prelabel", async () => {
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
  expect(await uploadResponse.json()).toEqual({ added: ["api"] });

  const heartbeatResponse = await handler(
    HeartbeatRoute,
    "POST",
  )({
    request: new Request("http://localhost/api/worker/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        workerId: "api-worker",
        startedAt: "2026-01-01T00:00:00Z",
        prelabeler: producer,
        current: ref,
      }),
    }),
  } as never);
  expect(heartbeatResponse.status).toBe(200);
  expect(readWorker("api-worker")?.current).toEqual(ref);

  const pendingUrl = `http://localhost/api/worker/pending?version_id=${producer.version_id}&fingerprint=${producer.fingerprint}`;
  const pendingResponse = await handler(
    PendingRoute,
    "GET",
  )({ request: new Request(pendingUrl) } as never);
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
        request: new Request("http://localhost/api/worker/pending"),
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
  };
  const put = (body: unknown) =>
    handler(
      PrelabelRoute,
      "PUT",
    )({
      params: ref,
      request: new Request("http://localhost/prelabel", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    } as never);
  expect((await put({ ...result, source: "images/api/x.jpg" })).status).toBe(
    400,
  );
  expect((await put(result)).status).toBe(200);
  expect(readPrelabel(ref)).toEqual(result);

  createLabel(ref, documentFromPrelabel(result));
  expect((await put(result)).status).toBe(409);
});
