import { afterEach, describe, expect, test } from "bun:test";

import { apiRequestAuthorization } from "./api-credentials";
import { issueApiKey } from "./api-keys";
import { apiKeyHeaders, signInAs } from "./testing";

const WORKER_CREDENTIALS = [
  "VITROFLOW_INFERENCE_WORKER_TOKEN",
  "VITROFLOW_TRAINING_WORKER_TOKEN",
] as const;

afterEach(() => {
  for (const credential of WORKER_CREDENTIALS) {
    delete process.env[credential];
  }
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

  test("worker realms admit only their own credential", async () => {
    process.env.VITROFLOW_INFERENCE_WORKER_TOKEN = "inference-secret";
    process.env.VITROFLOW_TRAINING_WORKER_TOKEN = "training-secret";
    const realms = [
      ["/api/inference/claims", "inference-secret"],
      ["/api/training/claims", "training-secret"],
    ] as const;
    for (const [pathname, token] of realms) {
      expect(await apiRequestAuthorization(pathname, bearer(token))).toBe(true);
      expect(await apiRequestAuthorization(pathname, bearer("wrong"))).toBe(
        false,
      );
      expect(await apiRequestAuthorization(pathname, bearer())).toBe(false);
    }
    expect(
      await apiRequestAuthorization(
        "/api/training/claims",
        bearer("inference-secret"),
      ),
    ).toBe(false);
  });

  test("an unconfigured worker realm is closed", async () => {
    expect(
      await apiRequestAuthorization("/api/inference/claims", bearer("any")),
    ).toBe(false);
  });

  test("the export realm admits only keys holding its scope", async () => {
    const { user } = await signInAs("member");
    const agent = await issueApiKey(user.id, {
      name: "Agent",
      scopes: ["agent"],
      expiresInDays: null,
    });
    const both = await issueApiKey(user.id, {
      name: "Both",
      scopes: ["agent", "export"],
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
        "/api/export/datasets/x",
        bearer(agent.secret),
      ),
    ).toBe(false);
    expect(
      await apiRequestAuthorization(
        "/api/export/datasets/x",
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
  });
});
