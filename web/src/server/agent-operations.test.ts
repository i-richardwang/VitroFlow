import { describe, expect, spyOn, test } from "bun:test";

import { z } from "zod";

import type { ExperimentGrid } from "../experiments/contracts";
import type {
  CultureEvent,
  Experiment,
  ExperimentObservation,
} from "../experiments/schema";
import {
  type AgentCallResult,
  type AgentOperation,
  agentOperations,
  callAgentOperation,
  describeAgentOperations,
  operation,
} from "./agent-operations";
import { baselineVersion } from "./testing";

function output(result: AgentCallResult): unknown {
  if (!result.ok) throw new Error(`Operation failed: ${result.message}`);
  return result.output;
}

function failure(result: AgentCallResult): { status: number; message: string } {
  if (result.ok) throw new Error("Operation unexpectedly succeeded");
  return { status: result.status, message: result.message };
}

describe("agent operations", () => {
  test("every operation describes itself with schemas and behavior hints", () => {
    const described = describeAgentOperations();
    expect(described.map(({ name }) => name)).toEqual([
      ...agentOperations.keys(),
    ]);
    for (const { description, annotations, input, output } of described) {
      expect(description.length).toBeGreaterThan(0);
      expect(input).toMatchObject({ type: "object" });
      expect(output).toBeDefined();
      expect(annotations.openWorldHint).toBe(false);
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
        expect(entry.annotations).toEqual({
          readOnlyHint: true,
          openWorldHint: false,
        });
      } else if (additive.has(name)) {
        expect(entry.annotations).toEqual({
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        });
      } else {
        expect(destructive.has(name)).toBe(true);
        expect(entry.annotations).toEqual({
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        });
      }
    }
  });

  test("an unknown operation names the known ones", async () => {
    const result = await callAgentOperation("open-portal", {});
    expect(failure(result).status).toBe(404);
    expect(failure(result).message).toContain("list-experiments");
  });

  test("prototype members are not operations", async () => {
    for (const name of ["toString", "constructor", "__proto__"]) {
      expect(failure(await callAgentOperation(name, {})).status).toBe(404);
    }
  });

  test("invalid input reports validation, not a defect", async () => {
    const result = await callAgentOperation("create-experiment", { name: "" });
    expect(failure(result).status).toBe(400);
    expect(failure(result).message).toContain("Experiment name is required");
  });

  test("a missing record answers not found, not an empty success", async () => {
    const absent = crypto.randomUUID();
    const read = await callAgentOperation("get-experiment", {
      experiment: absent,
    });
    expect(failure(read)).toEqual({
      status: 404,
      message: `Unknown experiment: ${absent}`,
    });

    const create = await callAgentOperation("create-experiment", {
      name: "Orphan",
      inoculatedOn: "2026-08-01",
      modelVersionId: "seed-detector",
    });
    expect(failure(create).status).toBe(404);
    expect(failure(create).message).toContain("Unknown model version");
  });

  test("defects are logged and sanitized, wherever they arose", async () => {
    const registry = new Map<string, AgentOperation>(
      [
        operation({
          name: "breaks",
          description: "Throws a non-domain error",
          annotations: {},
          input: z.strictObject({}),
          output: z.null(),
          handler: () => Promise.reject(new TypeError("internal detail")),
        }),
        operation({
          name: "lies",
          description: "Returns a value its output contract forbids",
          annotations: {},
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
        status: 500,
        message: "Internal error",
      });
      const contract = await callAgentOperation("lies", {}, registry);
      expect(failure(contract)).toEqual({
        status: 500,
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
    expect(failure(duplicate).status).toBe(409);

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
