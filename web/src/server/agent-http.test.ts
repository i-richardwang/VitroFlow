import { describe, expect, spyOn, test } from "bun:test";

import { z } from "zod";

import {
  describeAgentInterface,
  handleAgentOperationCall,
  serveAgentInterface,
  serveAgentOperationCall,
} from "./agent-http";
import { agentOperations, command } from "./agent-operations";
import { issueApiKey } from "./api-keys";
import type { ProgrammaticPrincipal } from "./programmatic-access";
import { apiKeyHeaders, signInAs } from "./testing";

const principal: ProgrammaticPrincipal = {
  kind: "api_key",
  userId: "user-1",
  credentialId: "key-1",
};

function post(body?: string): Request {
  return new Request("http://workbench/api/agent/op", {
    method: "POST",
    ...(body === undefined ? {} : { body }),
  });
}

describe("agent HTTP surface", () => {
  test("describes the interface with every operation", async () => {
    const described = (await describeAgentInterface().json()) as {
      call: string;
      upload: string;
      operations: { name: string }[];
    };
    expect(described.call).toContain("/api/agent/");
    expect(described.upload).toContain("/api/agent/images");
    expect(described.operations.map(({ name }) => name)).toEqual([
      ...agentOperations.keys(),
    ]);
  });

  test("the public routes require a live agent-scoped key", async () => {
    const denied = await serveAgentInterface(
      new Request("http://workbench/api/agent/operations"),
    );
    expect(denied.status).toBe(401);

    const { user } = await signInAs("member");
    const issued = await issueApiKey(user.id, {
      name: "Agent HTTP",
      scopes: ["agent"],
      expiresInDays: null,
    });
    const headers = apiKeyHeaders(issued.secret);
    const described = await serveAgentInterface(
      new Request("http://workbench/api/agent/operations", { headers }),
    );
    expect(described.status).toBe(200);

    const called = await serveAgentOperationCall(
      "list-experiments",
      new Request("http://workbench/api/agent/list-experiments", {
        method: "POST",
        headers,
        body: "{}",
      }),
    );
    expect(called.status).toBe(200);
  });

  test("an empty body calls the operation with no input", async () => {
    const response = await handleAgentOperationCall(
      "list-experiments",
      post(),
      principal,
    );
    expect(response.status).toBe(200);
    const { result } = (await response.json()) as { result: unknown };
    expect(Array.isArray(result)).toBe(true);
  });

  test("a body that is not JSON answers 400", async () => {
    const response = await handleAgentOperationCall(
      "list-experiments",
      post("not json"),
      principal,
    );
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(error).toEqual({
      code: "invalid_request",
      message: "Request body must be JSON",
    });
  });

  test("an unknown operation answers 404 naming the known ones", async () => {
    const response = await handleAgentOperationCall(
      "open-portal",
      post("{}"),
      principal,
    );
    expect(response.status).toBe(404);
    const { error } = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(error.code).toBe("not_found");
    expect(error.message).toContain("list-experiments");
  });

  test("invalid input answers 400 naming the offending field", async () => {
    const response = await handleAgentOperationCall(
      "create-experiment",
      post(JSON.stringify({ name: "" })),
      principal,
    );
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(error.code).toBe("invalid_request");
    expect(error.message).toContain("Experiment name is required");
  });

  test("a defect answers a sanitized 500", async () => {
    const defective = command({
      name: "defective",
      description: "A deliberately broken operation",
      destructive: false,
      input: z.strictObject({}),
      output: z.null(),
      handler: () => Promise.reject(new TypeError("internal detail")),
    });
    const registry = new Map([[defective.name, defective]]);

    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await handleAgentOperationCall(
        "defective",
        new Request("http://workbench/api/agent/defective", {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: "{}",
        }),
        principal,
        registry,
      );
      expect(response.status).toBe(500);
      const { error } = (await response.json()) as {
        error: { code: string; message: string };
      };
      expect(error).toEqual({
        code: "internal_error",
        message: "Internal error",
      });
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
