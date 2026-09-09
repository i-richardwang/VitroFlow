import { describe, expect, spyOn, test } from "bun:test";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { database } from "../infra/db/client";
import { models } from "../infra/db/schema";
import { ExperimentNotFoundError } from "../../experiments/errors";
import { type AgentCallResult, executeAgentOperation } from "./execution";
import { type AgentOperation, command } from "./operations";

function failure(result: AgentCallResult): { code: string; message: string } {
  if (result.ok) throw new Error("Operation unexpectedly succeeded");
  return { code: result.code, message: result.message };
}

function registryOf(
  ...operations: AgentOperation[]
): Map<string, AgentOperation> {
  return new Map(operations.map((operation) => [operation.name, operation]));
}

describe("agent execution", () => {
  test("an unknown operation names the known ones", async () => {
    const result = await executeAgentOperation("open-portal", {});
    expect(failure(result).code).toBe("not_found");
    expect(failure(result).message).toContain("list-experiments");
  });

  test("prototype members are not operations", async () => {
    for (const name of ["toString", "constructor", "__proto__"]) {
      expect(failure(await executeAgentOperation(name, {})).code).toBe(
        "not_found",
      );
    }
  });

  test("invalid input reports validation, not a defect", async () => {
    const result = await executeAgentOperation("create-experiment", {
      name: "",
    });
    expect(failure(result).code).toBe("invalid_request");
    expect(failure(result).message).toContain("Experiment name is required");
  });

  test("a missing record answers not found, not an empty success", async () => {
    const absent = crypto.randomUUID();
    const read = await executeAgentOperation("get-experiment", {
      experiment: absent,
    });
    expect(failure(read)).toEqual({
      code: "not_found",
      message: `Unknown experiment: ${absent}`,
    });

    const created = await executeAgentOperation("create-experiment", {
      name: `Orphan ${crypto.randomUUID()}`,
      inoculatedOn: "2026-08-01",
      treatments: [{ name: "T1", replicates: 1 }],
    });
    if (!created.ok) throw new Error(created.message);
    const observe = await executeAgentOperation("create-observation", {
      experiment: (created.output as { id: string }).id,
      observedOn: "2026-08-01",
      modelVersionId: "seed-detector",
      metric: "seeds",
    });
    expect(failure(observe).code).toBe("not_found");
    expect(failure(observe).message).toContain("Unknown model version");
  });

  test("defects are logged and sanitized, wherever they arose", async () => {
    const registry = registryOf(
      command({
        name: "breaks",
        description: "Throws a non-domain error",
        destructive: false,
        input: z.strictObject({}),
        output: z.null(),
        handler: () => Promise.reject(new TypeError("internal detail")),
      }),
      command({
        name: "lies",
        description: "Returns a value its output contract forbids",
        destructive: false,
        input: z.strictObject({}),
        output: z.null(),
        handler: async () => "wrong" as unknown as null,
      }),
    );

    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const defect = await executeAgentOperation("breaks", {}, registry);
      expect(failure(defect)).toEqual({
        code: "internal_error",
        message: "Internal error",
      });
      const contract = await executeAgentOperation("lies", {}, registry);
      expect(failure(contract)).toEqual({
        code: "internal_error",
        message: "Internal error",
      });
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });

  test("a command that fails leaves nothing behind", async () => {
    const id = `rolled-back-${crypto.randomUUID()}`;
    const registry = registryOf(
      command({
        name: "writes-then-fails",
        description: "Writes a row and then rejects the request",
        destructive: false,
        input: z.strictObject({}),
        output: z.null(),
        handler: async (_input, executor) => {
          await executor!.insert(models).values({
            id,
            name: id,
            task: "detect",
            classes: [],
            metrics: [],
          });
          throw new ExperimentNotFoundError(`Unknown experiment: ${id}`);
        },
      }),
    );

    const result = await executeAgentOperation(
      "writes-then-fails",
      {},
      registry,
    );
    expect(failure(result).code).toBe("not_found");
    const rows = await (
      await database()
    )
      .select({ id: models.id })
      .from(models)
      .where(eq(models.id, id));
    expect(rows).toEqual([]);
  });

  test("a command commits only if its output satisfies the contract", async () => {
    const id = `invalid-output-${crypto.randomUUID()}`;
    const registry = registryOf(
      command({
        name: "invalid-output",
        description: "Writes a row but violates the output contract",
        destructive: false,
        input: z.strictObject({}),
        output: z.null(),
        handler: async (_input, tx) => {
          await tx!
            .insert(models)
            .values({ id, name: id, task: "detect", classes: [], metrics: [] });
          return "wrong" as unknown as null;
        },
      }),
    );
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        failure(await executeAgentOperation("invalid-output", {}, registry))
          .code,
      ).toBe("internal_error");
      const rows = await (
        await database()
      )
        .select({ id: models.id })
        .from(models)
        .where(eq(models.id, id));
      expect(rows).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  test("a repeated command is refused by the record it would duplicate", async () => {
    const input = {
      name: `Twice ${crypto.randomUUID()}`,
      inoculatedOn: "2026-09-01",
      treatments: [{ name: "T1", replicates: 1 }],
    };
    expect((await executeAgentOperation("create-experiment", input)).ok).toBe(
      true,
    );
    expect(
      await executeAgentOperation("create-experiment", input),
    ).toMatchObject({ ok: false, code: "conflict" });
  });
});
