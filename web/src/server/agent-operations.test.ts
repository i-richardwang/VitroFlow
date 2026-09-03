import { describe, expect, spyOn, test } from "bun:test";

import { z } from "zod";

import type { ExperimentGrid } from "../experiments/contracts";
import type {
  CultureEvent,
  Experiment,
  ExperimentObservation,
} from "../experiments/schema";
import { type AgentCallResult, executeAgentOperation } from "./agent-execution";
import {
  type AgentOperation,
  agentOperations,
  command,
  describeAgentOperations,
} from "./agent-operations";
import { baselineVersion } from "./testing";

const testPrincipal = {
  kind: "api_key" as const,
  userId: "agent-operations-test",
  credentialId: "agent-operations-test",
};

function callAgentOperation(
  name: string,
  input: unknown,
  registry: ReadonlyMap<string, AgentOperation> = agentOperations,
): Promise<AgentCallResult> {
  const idempotencyKey =
    registry.get(name)?.kind === "command" ? crypto.randomUUID() : null;
  return executeAgentOperation(
    name,
    input,
    testPrincipal,
    idempotencyKey,
    registry,
  );
}

function output(result: AgentCallResult): unknown {
  if (!result.ok) throw new Error(`Operation failed: ${result.message}`);
  return result.output;
}

function failure(result: AgentCallResult): {
  code: string;
  message: string;
} {
  if (result.ok) throw new Error("Operation unexpectedly succeeded");
  return { code: result.code, message: result.message };
}

describe("agent operations", () => {
  test("every operation describes itself with schemas and behavior hints", () => {
    const described = describeAgentOperations();
    expect(described.map(({ name }) => name)).toEqual([
      ...agentOperations.keys(),
    ]);
    for (const { description, kind, input, output } of described) {
      expect(description.length).toBeGreaterThan(0);
      expect(input).toMatchObject({ type: "object" });
      expect(output).toBeDefined();
      expect(["query", "command"]).toContain(kind);
    }
  });

  test("behavior hints classify every operation explicitly", () => {
    const readOnly = new Set([
      "list-experiments",
      "list-model-versions",
      "get-experiment",
      "get-observation-unit",
    ]);
    const additive = new Set([
      "create-experiment",
      "create-treatment",
      "create-observation-units",
      "record-culture-event",
      "create-observation",
      "assign-images-to-observation",
    ]);
    const destructive = new Set([
      "update-experiment",
      "delete-experiment",
      "update-treatment",
      "delete-treatment",
      "update-observation-unit",
      "delete-observation-unit",
      "assign-observation-units",
      "void-culture-event",
      "update-observation",
      "delete-observation",
      "reassign-observation-image",
      "unassign-observation-image",
      "retry-observation-image-analysis",
    ]);
    expect([...readOnly, ...additive, ...destructive].sort()).toEqual(
      [...agentOperations.keys()].sort(),
    );

    for (const [name, entry] of agentOperations) {
      if (readOnly.has(name)) {
        expect(entry).toMatchObject({ kind: "query", destructive: false });
      } else if (additive.has(name)) {
        expect(entry).toMatchObject({ kind: "command", destructive: false });
      } else {
        expect(destructive.has(name)).toBe(true);
        expect(entry).toMatchObject({ kind: "command", destructive: true });
      }
    }
  });

  test("an unknown operation names the known ones", async () => {
    const result = await callAgentOperation("open-portal", {});
    expect(failure(result).code).toBe("not_found");
    expect(failure(result).message).toContain("list-experiments");
  });

  test("prototype members are not operations", async () => {
    for (const name of ["toString", "constructor", "__proto__"]) {
      expect(failure(await callAgentOperation(name, {})).code).toBe(
        "not_found",
      );
    }
  });

  test("invalid input reports validation, not a defect", async () => {
    const result = await callAgentOperation("create-experiment", { name: "" });
    expect(failure(result).code).toBe("invalid_request");
    expect(failure(result).message).toContain("Experiment name is required");
  });

  test("a missing record answers not found, not an empty success", async () => {
    const absent = crypto.randomUUID();
    const read = await callAgentOperation("get-experiment", {
      experiment: absent,
    });
    expect(failure(read)).toEqual({
      code: "not_found",
      message: `Unknown experiment: ${absent}`,
    });

    const create = await callAgentOperation("create-experiment", {
      name: "Orphan",
      inoculatedOn: "2026-08-01",
      modelVersionId: "seed-detector",
    });
    expect(failure(create).code).toBe("not_found");
    expect(failure(create).message).toContain("Unknown model version");
  });

  test("defects are logged and sanitized, wherever they arose", async () => {
    const registry = new Map<string, AgentOperation>(
      [
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
      ].map((entry) => [entry.name, entry]),
    );

    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const defect = await callAgentOperation("breaks", {}, registry);
      expect(failure(defect)).toEqual({
        code: "internal_error",
        message: "Internal error",
      });
      const contract = await callAgentOperation("lies", {}, registry);
      expect(failure(contract)).toEqual({
        code: "internal_error",
        message: "Internal error",
      });
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });

  test("operations drive a data-entry workflow end to end", async () => {
    const version = await baselineVersion();
    const experiment = output(
      await callAgentOperation("create-experiment", {
        name: "Agent entry",
        inoculatedOn: "2026-08-01",
        modelVersionId: version.id,
      }),
    ) as Experiment;

    output(
      await callAgentOperation("create-treatment", {
        experiment: experiment.id,
        name: "T1",
        replicates: 2,
      }),
    );
    const duplicate = await callAgentOperation("create-treatment", {
      experiment: experiment.id,
      name: "T1",
      replicates: 0,
    });
    expect(failure(duplicate).code).toBe("conflict");

    const observation = output(
      await callAgentOperation("create-observation", {
        experiment: experiment.id,
        observedOn: "2026-08-15",
      }),
    ) as ExperimentObservation;
    expect(observation.observedOn).toBe("2026-08-15");

    const grid = output(
      await callAgentOperation("get-experiment", {
        experiment: experiment.id,
      }),
    ) as ExperimentGrid;
    expect(grid.treatments.map(({ name }) => name)).toContain("T1");
    expect(grid.observationUnits).toHaveLength(2);

    const summaries = output(
      await callAgentOperation("list-experiments", {}),
    ) as { experiment: { id: string } }[];
    expect(summaries.map((summary) => summary.experiment.id)).toContain(
      experiment.id,
    );
  });

  test("a culture event without an exclusion choice takes its type's default", async () => {
    const version = await baselineVersion();
    const experiment = output(
      await callAgentOperation("create-experiment", {
        name: "Event defaults",
        inoculatedOn: "2026-08-01",
        modelVersionId: version.id,
      }),
    ) as Experiment;
    output(
      await callAgentOperation("create-treatment", {
        experiment: experiment.id,
        name: "T1",
        replicates: 2,
      }),
    );
    const observation = output(
      await callAgentOperation("create-observation", {
        experiment: experiment.id,
        observedOn: "2026-08-10",
      }),
    ) as ExperimentObservation;
    const grid = output(
      await callAgentOperation("get-experiment", {
        experiment: experiment.id,
      }),
    ) as ExperimentGrid;
    const [first, second] = grid.observationUnits;

    const contaminated = output(
      await callAgentOperation("record-culture-event", {
        experiment: experiment.id,
        observationUnit: first!.id,
        observation: observation.id,
        type: "contaminated",
      }),
    ) as CultureEvent;
    expect(contaminated.excludeFromObservation).toBe(true);

    const harvested = output(
      await callAgentOperation("record-culture-event", {
        experiment: experiment.id,
        observationUnit: second!.id,
        observation: observation.id,
        type: "harvested",
        excludeFromObservation: true,
      }),
    ) as CultureEvent;
    expect(harvested.excludeFromObservation).toBe(true);
  });
});
