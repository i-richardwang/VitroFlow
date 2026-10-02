import { describe, expect, test } from "bun:test";

import { guardMcpRequest } from "./access";

describe("MCP request guard", () => {
  const request = (hostname: string, origin?: string): Request =>
    new Request(`http://${hostname}/api/experiments/mcp`, {
      method: "POST",
      headers: {
        Host: hostname,
        ...(origin === undefined ? {} : { Origin: origin }),
      },
    });

  test("localhost requests pass without an Origin header", () => {
    expect(guardMcpRequest(request("localhost"))).toBeNull();
  });

  test("localhost browser requests pass", () => {
    expect(
      guardMcpRequest(request("localhost", "http://localhost:3000")),
    ).toBeNull();
  });

  test("a missing or foreign Host is rejected", () => {
    const missing = new Request("http://localhost/api/experiments/mcp", {
      method: "POST",
    });
    expect(guardMcpRequest(missing)?.status).toBe(403);
    expect(guardMcpRequest(request("workbench"))?.status).toBe(403);
  });

  test("a production deployment's Host and Origin pass", () => {
    const configured = process.env.BETTER_AUTH_URL;
    process.env.BETTER_AUTH_URL = "https://lab.example";
    try {
      expect(guardMcpRequest(request("lab.example"))).toBeNull();
      expect(
        guardMcpRequest(request("lab.example", "https://lab.example")),
      ).toBeNull();
    } finally {
      process.env.BETTER_AUTH_URL = configured;
    }
  });

  test("a foreign browser Origin is rejected", () => {
    expect(
      guardMcpRequest(request("localhost", "https://evil.example"))?.status,
    ).toBe(403);
  });
});
