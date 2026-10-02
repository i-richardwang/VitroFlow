import { describe, expect, test } from "bun:test";

import { guardMcpRequest, serveWithOAuth } from "./access";
import { serveAnnotationMcp } from "./annotation";
import { serveExperimentsMcp } from "./experiments";
import { authorizeMcpClient, signInAs } from "../../testing/fixtures";
import { createDpopKey } from "../../testing/dpop";
import { modernRequest } from "../../testing/mcp";
import { disconnectMcpClient, listMcpClients } from "../../auth/mcp-clients";

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

describe("MCP OAuth request lifecycle", () => {
  for (const server of ["experiments", "annotation"] as const) {
    test(`${server} accepts bound DPoP tokens and rejects invalid or replayed proofs`, async () => {
      const { user, headers } = await signInAs("member");
      const key = await createDpopKey();
      const otherKey = await createDpopKey();
      const { accessToken } = await authorizeMcpClient(headers, {
        server,
        dpop: key,
      });
      const endpoint = `${process.env.BETTER_AUTH_URL}/api/${server}/mcp`;
      const serve =
        server === "experiments" ? serveExperimentsMcp : serveAnnotationMcp;
      const call = async (proof?: string) => {
        const request = modernRequest(endpoint, "tools/list");
        request.headers.set("authorization", `DPoP ${accessToken}`);
        if (proof) request.headers.set("dpop", proof);
        return serve(request);
      };

      expect((await call()).status).toBe(401);
      expect(
        (await call(await otherKey.proof(endpoint, accessToken))).status,
      ).toBe(401);
      expect(
        (await call(await key.proof(endpoint, "different-token"))).status,
      ).toBe(401);
      expect(
        (await call(await key.proof(`${endpoint}/other`, accessToken))).status,
      ).toBe(401);
      expect(
        (
          await serve(
            modernRequest(endpoint, "tools/list", undefined, accessToken),
          )
        ).status,
      ).toBe(401);

      const proof = await key.proof(endpoint, accessToken);
      expect((await call(proof)).status).toBe(200);
      expect((await call(proof)).status).toBe(401);

      const otherEndpoint = `${process.env.BETTER_AUTH_URL}/api/${server === "experiments" ? "annotation" : "experiments"}/mcp`;
      const otherRequest = modernRequest(otherEndpoint, "tools/list");
      otherRequest.headers.set("authorization", `DPoP ${accessToken}`);
      otherRequest.headers.set(
        "dpop",
        await key.proof(otherEndpoint, accessToken),
      );
      const otherServe =
        server === "experiments" ? serveAnnotationMcp : serveExperimentsMcp;
      expect((await otherServe(otherRequest)).status).toBe(401);

      const [client] = await listMcpClients(user.id);
      await disconnectMcpClient(user.id, client!.id);
      expect((await call(await key.proof(endpoint, accessToken))).status).toBe(
        401,
      );
    });
  }

  test("each accepted request uses the handler supplied by its caller", async () => {
    const { headers } = await signInAs("member");
    const { accessToken } = await authorizeMcpClient(headers);
    const endpoint = `${process.env.BETTER_AUTH_URL}/api/experiments/mcp`;
    for (const label of ["first", "second"]) {
      const response = await serveWithOAuth(
        "experiments",
        modernRequest(endpoint, "tools/list", undefined, accessToken),
        async (_, grant) => Response.json({ label, token: grant.token }),
      );
      expect(await response.json()).toEqual({ label, token: accessToken });
    }
  });

  test("an initialization failure remains retryable after bootstrap", async () => {
    const accessPath = new URL("./access.ts", import.meta.url).pathname;
    const setupPath = new URL("../../../../test/setup.ts", import.meta.url)
      .pathname;
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `
      const { serveWithOAuth } = await import(${JSON.stringify(accessPath)});
      const request = () => new Request(process.env.BETTER_AUTH_URL + "/api/experiments/mcp");
      const handle = async () => new Response("unexpected");
      try {
        await serveWithOAuth("experiments", request(), handle);
        throw new Error("Expected initialization to fail");
      } catch (error) {
        if (!error.message.includes("Database is not configured")) throw error;
      }
      await import(${JSON.stringify(setupPath)});
      const response = await serveWithOAuth("experiments", request(), handle);
      if (response.status !== 401) throw new Error("Expected an OAuth challenge after recovery");
      process.exit(0);
    `,
      ],
      {
        env: { ...process.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [status, output] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(output).not.toContain("Expected");
    expect(status).toBe(0);
  }, 15_000);
});
