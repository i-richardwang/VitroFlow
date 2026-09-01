import { describe, expect, spyOn, test } from "bun:test";

import { z } from "zod";

import { describeAgentInterface, handleAgentOperationCall } from "./agent-http";
import { agentOperations, operation } from "./agent-operations";

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

  test("an empty body calls the operation with no input", async () => {
    const response = await handleAgentOperationCall("list-experiments", post());
    expect(response.status).toBe(200);
    const { result } = (await response.json()) as { result: unknown };
    expect(Array.isArray(result)).toBe(true);
  });

  test("a body that is not JSON answers 400", async () => {
    const response = await handleAgentOperationCall(
      "list-experiments",
      post("not json"),
    );
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: string };
    expect(error).toBe("Request body must be JSON");
  });

  test("an unknown operation answers 404 naming the known ones", async () => {
    const response = await handleAgentOperationCall("open-portal", post("{}"));
    expect(response.status).toBe(404);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain("list-experiments");
  });

  test("invalid input answers 400 naming the offending field", async () => {
    const response = await handleAgentOperationCall(
      "create-experiment",
      post(JSON.stringify({ name: "" })),
    );
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain("Experiment name is required");
  });

  test("a defect answers a sanitized 500", async () => {
    const defective = operation({
      name: "defective",
      description: "A deliberately broken operation",
      annotations: {},
      input: z.strictObject({}),
      output: z.null(),
      handler: () => Promise.reject(new TypeError("internal detail")),
    });
    const registry = new Map([[defective.name, defective]]);

    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await handleAgentOperationCall(
        "defective",
        post("{}"),
        registry,
      );
      expect(response.status).toBe(500);
      const { error } = (await response.json()) as { error: string };
      expect(error).toBe("Internal error");
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
