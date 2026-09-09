import { afterEach, describe, expect, test } from "bun:test";

import { apiRequestAuthorization } from "./authorization";
import { issueApiKey } from "../../auth/api-keys";
import { apiKeyHeaders, signInAs } from "../../testing/fixtures";

afterEach(() => {
  delete process.env.VITROFLOW_WORKER_TOKEN;
});

function bearer(token?: string): Request {
  return new Request("http://workbench", {
    headers: token === undefined ? {} : apiKeyHeaders(token),
  });
}

describe("API credentials", () => {
  test("session paths belong to no bearer realm", async () => {
    for (const pathname of ["/", "/login", "/experiments", "/api/mcp"]) {
      expect(await apiRequestAuthorization(pathname, bearer("x"))).toBe(null);
    }
  });

  test("the worker realm admits only the worker credential", async () => {
    process.env.VITROFLOW_WORKER_TOKEN = "worker-secret";
    for (const pathname of [
      "/api/worker/heartbeat",
      "/api/worker/inference/claim",
      "/api/worker/training/claim",
    ]) {
      expect(
        await apiRequestAuthorization(pathname, bearer("worker-secret")),
      ).toBe(true);
      expect(await apiRequestAuthorization(pathname, bearer("wrong"))).toBe(
        false,
      );
      expect(await apiRequestAuthorization(pathname, bearer())).toBe(false);
    }
  });

  test("an unconfigured worker realm is closed", async () => {
    expect(
      await apiRequestAuthorization("/api/worker/heartbeat", bearer("any")),
    ).toBe(false);
  });

  test("the transfer realm admits keys holding its scope and defers to the session otherwise", async () => {
    const { user } = await signInAs("member");
    const agent = await issueApiKey(user.id, {
      name: "Agent",
      scopes: ["agent"],
      expiresInDays: null,
    });
    const both = await issueApiKey(user.id, {
      name: "Both",
      scopes: ["agent", "transfer"],
      expiresInDays: 30,
    });
    expect(
      await apiRequestAuthorization(
        "/api/agent/list-experiments",
        bearer(agent.secret),
      ),
    ).toBe(null);
    expect(
      await apiRequestAuthorization(
        "/api/transfer/datasets/x",
        bearer(agent.secret),
      ),
    ).toBe(false);
    expect(
      await apiRequestAuthorization(
        "/api/transfer/datasets/x",
        bearer(both.secret),
      ),
    ).toBe(true);
    expect(
      await apiRequestAuthorization(
        "/api/agent/list-experiments",
        bearer("vf_wrong"),
      ),
    ).toBe(null);
    expect(
      await apiRequestAuthorization("/api/agent/list-experiments", bearer()),
    ).toBe(null);
    expect(
      await apiRequestAuthorization("/api/transfer/datasets/x", bearer()),
    ).toBe(null);
    expect(
      await apiRequestAuthorization(
        "/api/transfer/datasets/x",
        bearer("vf_wrong"),
      ),
    ).toBe(false);
  });
});
