import { afterEach, describe, expect, test } from "bun:test";

import { apiRequestAuthorization } from "./api-credentials";

const CREDENTIALS = [
  "VITROFLOW_INFERENCE_WORKER_TOKEN",
  "VITROFLOW_TRAINING_WORKER_TOKEN",
  "VITROFLOW_AGENT_TOKEN",
  "VITROFLOW_EXPORT_TOKEN",
] as const;

afterEach(() => {
  for (const credential of CREDENTIALS) {
    delete process.env[credential];
  }
});

function bearer(token?: string): Request {
  return new Request("http://workbench", {
    headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
  });
}

describe("API credentials", () => {
  test("session paths belong to no token realm", () => {
    process.env.VITROFLOW_AGENT_TOKEN = "agent-secret";
    for (const pathname of ["/", "/login", "/experiments", "/api/mcpx"]) {
      expect(apiRequestAuthorization(pathname, bearer("agent-secret"))).toBe(
        null,
      );
    }
  });

  test("each realm admits only its own credential", () => {
    process.env.VITROFLOW_INFERENCE_WORKER_TOKEN = "inference-secret";
    process.env.VITROFLOW_TRAINING_WORKER_TOKEN = "training-secret";
    process.env.VITROFLOW_AGENT_TOKEN = "agent-secret";
    process.env.VITROFLOW_EXPORT_TOKEN = "export-secret";
    const realms = [
      ["/api/inference/claims", "inference-secret"],
      ["/api/training/claims", "training-secret"],
      ["/api/agent/list-experiments", "agent-secret"],
      ["/api/mcp", "agent-secret"],
      ["/api/export/dataset", "export-secret"],
    ] as const;
    for (const [pathname, token] of realms) {
      expect(apiRequestAuthorization(pathname, bearer(token))).toBe(true);
      expect(apiRequestAuthorization(pathname, bearer("wrong"))).toBe(false);
      expect(apiRequestAuthorization(pathname, bearer())).toBe(false);
    }
    expect(
      apiRequestAuthorization(
        "/api/agent/list-experiments",
        bearer("export-secret"),
      ),
    ).toBe(false);
    expect(
      apiRequestAuthorization("/api/mcp", bearer("inference-secret")),
    ).toBe(false);
  });

  test("a realm without a configured credential is closed", () => {
    expect(
      apiRequestAuthorization("/api/agent/list-experiments", bearer()),
    ).toBe(false);
    expect(apiRequestAuthorization("/api/mcp", bearer(""))).toBe(false);
  });
});
