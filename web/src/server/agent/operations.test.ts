import { describe, expect, test } from "bun:test";

import type { ExperimentGrid } from "../../domain/experiments/contracts";
import type {
  CultureEvent,
  Experiment,
  ExperimentObservation,
} from "../../domain/experiments/schema";
import { type AgentCallResult, executeAgentOperation } from "./execution";
import { agentOperations, describeAgentOperations } from "./operations";
import { baselineVersion } from "../testing/fixtures";

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
      "get-unit",
    ]);
    const additive = new Set([
      "create-experiment",
      "create-treatment",
      "add-replicates",
      "record-culture-event",
      "create-observation",
      "assign-images-to-observation",
    ]);
    const destructive = new Set([
      "update-experiment",
      "delete-experiment",
      "update-treatment",
      "delete-treatment",
      "update-unit",
      "delete-unit",
      "remove-culture-event",
      "update-observation",
      "delete-observation",
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

  test("operations drive a data-entry workflow end to end", async () => {
    const version = await baselineVersion();
    const experiment = output(
      await executeAgentOperation("create-experiment", {
        name: "Agent entry",
        inoculatedOn: "2026-08-01",
        treatments: [{ name: "T1", replicates: 2 }],
      }),
    ) as Experiment;

    const duplicate = await executeAgentOperation("create-treatment", {
      experiment: experiment.id,
      name: "T1",
      replicates: 1,
    });
    expect(failure(duplicate).code).toBe("conflict");

    const observation = output(
      await executeAgentOperation("create-observation", {
        experiment: experiment.id,
        observedOn: "2026-08-15",
        modelVersionId: version.id,
      }),
    ) as ExperimentObservation;
    expect(observation.observedOn).toBe("2026-08-15");

    const grid = output(
      await executeAgentOperation("get-experiment", {
        experiment: experiment.id,
      }),
    ) as ExperimentGrid;
    expect(grid.treatments.map(({ name }) => name)).toContain("T1");
    expect(grid.units).toHaveLength(2);

    const summaries = output(
      await executeAgentOperation("list-experiments", {}),
    ) as { experiment: { id: string } }[];
    expect(summaries.map((summary) => summary.experiment.id)).toContain(
      experiment.id,
    );
  });

  test("a culture event is recorded against its unit and observation", async () => {
    const version = await baselineVersion();
    const experiment = output(
      await executeAgentOperation("create-experiment", {
        name: "Culture events",
        inoculatedOn: "2026-08-01",
        treatments: [{ name: "T1", replicates: 2 }],
      }),
    ) as Experiment;
    const observation = output(
      await executeAgentOperation("create-observation", {
        experiment: experiment.id,
        observedOn: "2026-08-10",
        modelVersionId: version.id,
      }),
    ) as ExperimentObservation;
    const grid = output(
      await executeAgentOperation("get-experiment", {
        experiment: experiment.id,
      }),
    ) as ExperimentGrid;
    const [first, second] = grid.units;

    const contaminated = output(
      await executeAgentOperation("record-culture-event", {
        experiment: experiment.id,
        unit: first!.id,
        observation: observation.id,
        type: "contaminated",
      }),
    ) as CultureEvent;
    expect(contaminated.type).toBe("contaminated");

    const harvested = output(
      await executeAgentOperation("record-culture-event", {
        experiment: experiment.id,
        unit: second!.id,
        observation: observation.id,
        type: "harvested",
      }),
    ) as CultureEvent;
    expect(harvested.observation).toBe(observation.id);
  });
});
