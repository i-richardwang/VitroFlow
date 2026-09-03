import { describe, expect, test } from "bun:test";

import { McpClientNotFoundError } from "../auth/errors";
import { guardMcpRequest, mcpHandler, serveMcp } from "./agent-mcp";
import { agentOperations } from "./agent-operations";
import { disconnectMcpClient, listMcpClients } from "./mcp-clients";
import { authorizeMcpClient, baselineVersion, signInAs } from "./testing";
import { banUser, revokeUserSessions } from "./users";

const envelope = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

function modernRequest(
  url: string,
  method: string,
  params?: Record<string, unknown>,
  token?: string,
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      host: new URL(url).host,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-method": method,
      ...(method === "tools/call" && typeof params?.name === "string"
        ? { "mcp-name": params.name }
        : {}),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, _meta: envelope },
    }),
  });
}

async function rpc(method: string, params?: unknown): Promise<unknown> {
  const response = await mcpHandler.fetch(
    modernRequest(
      "http://workbench/api/mcp",
      method,
      params as Record<string, unknown> | undefined,
    ),
    {
      authInfo: {
        token: "test",
        clientId: "test-client",
        scopes: [],
        extra: {
          principal: {
            kind: "api_key",
            userId: "test-user",
            credentialId: "test-key",
          },
        },
      },
    },
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
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      code: "not_found",
      message: expect.stringContaining("Unknown experiment"),
    });
  });

  test("a mutation carries an explicit idempotency envelope", async () => {
    const version = await baselineVersion();
    const idempotencyKey = crypto.randomUUID();
    const params = {
      name: "create-experiment",
      arguments: {
        idempotencyKey,
        input: {
          name: `MCP ${idempotencyKey}`,
          inoculatedOn: "2026-09-02",
          modelVersionId: version.id,
        },
      },
    };
    const first = (await rpc("tools/call", params)) as {
      structuredContent: { id: string };
    };
    const repeated = (await rpc("tools/call", params)) as {
      structuredContent: { id: string };
    };
    expect(repeated.structuredContent.id).toBe(first.structuredContent.id);
  });
});

describe("MCP request guard", () => {
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

  test("a missing or foreign Host is rejected", () => {
    const missing = new Request("http://localhost/api/mcp", {
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

describe("MCP endpoint authorization", () => {
  const endpoint = () => `${process.env.BETTER_AUTH_URL}/api/mcp`;

  const call = (token?: string): Promise<Response> =>
    serveMcp(modernRequest(endpoint(), "tools/list", undefined, token));

  test("a request without a token is challenged toward the resource metadata", async () => {
    const response = await call();
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain("Bearer");
    expect(challenge).toContain(
      `${process.env.BETTER_AUTH_URL}/.well-known/oauth-protected-resource/api/mcp`,
    );
  });

  test("the resource metadata names this workbench as the authorization server", async () => {
    const response = await fetch(
      `${process.env.BETTER_AUTH_URL}/.well-known/oauth-protected-resource/api/mcp`,
    );
    expect(response.status).toBe(200);
    const metadata = (await response.json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(metadata.resource).toBe(endpoint());
    expect(metadata.authorization_servers).toEqual([
      `${process.env.BETTER_AUTH_URL}/api/auth`,
    ]);
  });

  test("a client the account authorized reaches the tools until it is disconnected", async () => {
    const { user, headers } = await signInAs("member");
    const { clientId, accessToken } = await authorizeMcpClient(
      headers,
      "Claude on the bench",
    );

    const accepted = await call(accessToken);
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toContain("list-experiments");

    const [client] = await listMcpClients(user.id);
    expect(client).toMatchObject({ clientId, name: "Claude on the bench" });

    const other = await signInAs("member");
    expect(await listMcpClients(other.user.id)).toEqual([]);
    await expect(
      disconnectMcpClient(other.user.id, client!.id),
    ).rejects.toBeInstanceOf(McpClientNotFoundError);

    await disconnectMcpClient(user.id, client!.id);
    expect(await listMcpClients(user.id)).toEqual([]);
    expect((await call(accessToken)).status).toBe(401);
  });

  test("suspending the account invalidates an issued access token", async () => {
    const admin = await signInAs("admin");
    const member = await signInAs("member");
    const { accessToken } = await authorizeMcpClient(member.headers);
    expect((await call(accessToken)).status).toBe(200);
    await banUser(admin.headers, {
      user: member.user.id,
      reason: "left the lab",
    });
    expect((await call(accessToken)).status).toBe(401);
  });

  test("revoking the account's sessions invalidates an issued access token", async () => {
    const admin = await signInAs("admin");
    const member = await signInAs("member");
    const { accessToken } = await authorizeMcpClient(member.headers);
    expect((await call(accessToken)).status).toBe(200);
    await revokeUserSessions(admin.headers, { user: member.user.id });
    expect((await call(accessToken)).status).toBe(401);
  });

  test("legacy MCP requests are rejected", async () => {
    const { headers } = await signInAs("member");
    const { accessToken } = await authorizeMcpClient(headers);
    const request = new Request(endpoint(), {
      method: "POST",
      headers: {
        host: new URL(endpoint()).host,
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect((await serveMcp(request)).status).toBe(400);
  });

  test("a forged token is refused", async () => {
    const response = await call("not-a-token");
    expect(response.status).toBe(401);
  });
});
