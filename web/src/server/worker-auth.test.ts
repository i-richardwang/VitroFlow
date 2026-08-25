import { afterEach, describe, expect, test } from "bun:test";

import { isWorkerAuthenticated } from "./worker-auth";

const originalToken = process.env.VITROFLOW_WORKER_TOKEN;

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.VITROFLOW_WORKER_TOKEN;
  } else {
    process.env.VITROFLOW_WORKER_TOKEN = originalToken;
  }
});

describe("worker authentication", () => {
  test("requires a configured matching bearer token", () => {
    delete process.env.VITROFLOW_WORKER_TOKEN;
    expect(isWorkerAuthenticated(new Request("http://localhost"))).toBe(false);

    process.env.VITROFLOW_WORKER_TOKEN = "worker-secret";
    expect(isWorkerAuthenticated(new Request("http://localhost"))).toBe(false);
    expect(
      isWorkerAuthenticated(
        new Request("http://localhost", {
          headers: { Authorization: "Bearer wrong" },
        }),
      ),
    ).toBe(false);
    expect(
      isWorkerAuthenticated(
        new Request("http://localhost", {
          headers: { Authorization: "Bearer worker-secret" },
        }),
      ),
    ).toBe(true);
  });
});
