import { describe, expect, test } from "bun:test";

import { deploymentEndpoint } from "./deployment";

function configuredAs(value: string, read: () => void): void {
  const previous = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL = value;
  try {
    read();
  } finally {
    process.env.BETTER_AUTH_URL = previous;
  }
}

describe("deployment endpoint", () => {
  test("derives every public identifier from one origin", () => {
    configuredAs("https://lab.example", () => {
      expect(deploymentEndpoint()).toEqual({
        origin: "https://lab.example",
        hostname: "lab.example",
        mcpResource: "https://lab.example/api/mcp",
      });
    });
  });

  test("permits HTTP only on loopback", () => {
    for (const value of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ]) {
      configuredAs(value, () =>
        expect(deploymentEndpoint().origin).toBe(value),
      );
    }
    configuredAs("http://lab.example", () => {
      expect(deploymentEndpoint).toThrow("must use HTTPS");
    });
  });

  test("rejects values that are not an origin", () => {
    for (const value of [
      "https://lab.example/path",
      "https://lab.example?mode=test",
      "https://user:secret@lab.example",
    ]) {
      configuredAs(value, () => expect(deploymentEndpoint).toThrow());
    }
  });
});
