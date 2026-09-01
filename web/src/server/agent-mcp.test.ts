import { afterEach, describe, expect, test } from "bun:test";

import { guardMcpRequest, mcpHandler } from "./agent-mcp";
import { agentOperations } from "./agent-operations";

async function rpc(method: string, params?: unknown): Promise<unknown> {
  const response = await mcpHandler.fetch(
    new Request("http://workbench/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  expect(response.status).toBe(200);
  const body = await response.text();
  const payloads = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as unknown);
  const message = (payloads.at(-1) ?? JSON.parse(body)) as { result: unknown };
  return message.result;
}

describe("agent MCP surface", () => {
  test("lists every registry operation as a fully described tool", async () => {
    const { tools } = (await rpc("tools/list")) as {
      tools: {
        name: string;
        description?: string;
        inputSchema?: unknown;
        outputSchema?: unknown;
        annotations?: Record<string, unknown>;
      }[];
    };
    expect(tools.map(({ name }) => name).sort()).toEqual(
      [...agentOperations.keys()].sort(),
    );
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toMatchObject({ openWorldHint: false });
    }
  });

  test("a tool call returns structured content", async () => {
    const result = (await rpc("tools/call", {
      name: "list-experiments",
      arguments: {},
    })) as { structuredContent?: unknown; isError?: boolean };
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();
  });

  test("a domain failure reads as a tool error, not a protocol error", async () => {
    const result = (await rpc("tools/call", {
      name: "get-experiment",
      arguments: { experiment: crypto.randomUUID() },
    })) as { content: { type: string; text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Unknown experiment");
  });
});

describe("MCP request guard", () => {
  afterEach(() => {
    delete process.env.VITROFLOW_MCP_ALLOWED_HOSTNAMES;
  });

  const request = (hostname: string, origin?: string): Request =>
    new Request(`http://${hostname}/api/mcp`, {
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

  test("a missing or unconfigured Host is rejected", () => {
    const missing = new Request("http://localhost/api/mcp", {
      method: "POST",
    });
    expect(guardMcpRequest(missing)?.status).toBe(403);
    expect(guardMcpRequest(request("workbench"))?.status).toBe(403);
  });

  test("configured Host and Origin hostnames pass", () => {
    process.env.VITROFLOW_MCP_ALLOWED_HOSTNAMES =
      "workbench.internal, lab.example";
    expect(guardMcpRequest(request("workbench.internal"))).toBeNull();
    expect(
      guardMcpRequest(
        request("workbench.internal", "https://lab.example:8443"),
      ),
    ).toBeNull();
  });

  test("an untrusted Host or browser Origin is rejected", () => {
    process.env.VITROFLOW_MCP_ALLOWED_HOSTNAMES = "workbench.internal";
    expect(
      guardMcpRequest(request("evil.example", "http://evil.example"))?.status,
    ).toBe(403);
    expect(
      guardMcpRequest(request("workbench.internal", "https://evil.example"))
        ?.status,
    ).toBe(403);
  });
});
