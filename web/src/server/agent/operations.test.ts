import { describe, expect, test } from "bun:test";

import type { Dataset } from "../../domain/datasets/schema";
import type { ExperimentGrid } from "../../domain/experiments/contracts";
import type {
  CultureEvent,
  Experiment,
  ExperimentObservation,
} from "../../domain/experiments/schema";
import { type AgentCallResult, executeAgentOperation } from "./execution";
import { agentOperations, describeAgentOperations } from "./operations";
import { storeAnnotation } from "../annotations/documents";
import { createModel } from "../models/public";
import {
  baselineVersion,
  imageDigest,
  observeImagesForModel,
  storeTexts,
} from "../testing/fixtures";

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
      "get-inference-task",
      "list-model-versions",
      "list-training",
      "list-training-workers",
      "get-training",
      "list-experiments",
      "list-models",
      "get-experiment",
      "get-unit",
      "list-datasets",
      "get-dataset",
    ]);
    const additive = new Set([
      "prepare-model-upload",
      "register-model-upload",
      "start-training",
      "create-experiment",
      "create-treatment",
      "add-replicates",
      "record-culture-event",
      "create-observation",
      "create-model",
      "assign-images-to-observation",
      "create-dataset",
      "add-images-to-dataset",
    ]);
    const destructive = new Set([
      "retry-inference-task",
      "use-model-version",
      "control-training",
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
      "mark-image-unclear",
      "clear-image-unclear",
      "update-model-annotation",
      "delete-model",
      "update-dataset",
      "remove-images-from-dataset",
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
        modelId: version.modelId,
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
        modelId: version.modelId,
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

  test("a photograph is marked unclear by digest, or as it is assigned", async () => {
    const version = await baselineVersion();
    const experiment = output(
      await executeAgentOperation("create-experiment", {
        name: "Agent unclear",
        inoculatedOn: "2026-08-01",
        treatments: [{ name: "T1", replicates: 2 }],
      }),
    ) as Experiment;
    const observation = output(
      await executeAgentOperation("create-observation", {
        experiment: experiment.id,
        observedOn: "2026-08-10",
        modelId: version.modelId,
      }),
    ) as ExperimentObservation;
    const { units } = output(
      await executeAgentOperation("get-experiment", {
        experiment: experiment.id,
      }),
    ) as ExperimentGrid;
    const [fogged, blurred] = await storeTexts(["agent-fogged", "agent-blur"]);
    output(
      await executeAgentOperation("assign-images-to-observation", {
        experiment: experiment.id,
        observation: observation.id,
        images: [
          {
            unit: units[0]!.id,
            digest: fogged,
            filename: "fogged.jpg",
            unclear: { note: "  Lid fogged " },
          },
          { unit: units[1]!.id, digest: blurred, filename: "blurred.jpg" },
        ],
      }),
    );
    const cells = async () =>
      new Map(
        (
          output(
            await executeAgentOperation("get-experiment", {
              experiment: experiment.id,
            }),
          ) as ExperimentGrid
        ).images.map((image) => [image.digest, image.unclear]),
      );
    // Not counted unless the mark says so, and the note is trimmed.
    expect((await cells()).get(fogged!)).toMatchObject({
      counted: false,
      note: "Lid fogged",
    });
    expect((await cells()).get(blurred!)).toBeNull();

    const marked = { digest: blurred, counted: true, note: "Slightly soft" };
    for (let call = 0; call < 2; call++) {
      expect(
        output(await executeAgentOperation("mark-image-unclear", marked)),
      ).toMatchObject(marked);
    }
    expect((await cells()).get(blurred!)?.counted).toBe(true);

    expect(
      output(
        await executeAgentOperation("clear-image-unclear", { digest: fogged }),
      ),
    ).toEqual({ digest: fogged, cleared: true });
    expect(
      output(
        await executeAgentOperation("clear-image-unclear", { digest: fogged }),
      ),
    ).toEqual({ digest: fogged, cleared: false });
    expect((await cells()).get(fogged!)).toBeNull();

    expect(
      failure(
        await executeAgentOperation("mark-image-unclear", {
          digest: "f".repeat(64),
        }),
      ).code,
    ).toBe("not_found");
    expect(
      failure(
        await executeAgentOperation("mark-image-unclear", {
          digest: fogged,
          note: "x".repeat(501),
        }),
      ).code,
    ).toBe("invalid_request");
  });

  test("experiment images join and leave a dataset, keeping their reviews", async () => {
    const model = await createModel({
      id: "agent-dataset-task",
      name: "Agent dataset task",
      classes: ["shoot"],
    });
    const { images } = await observeImagesForModel(
      "Agent dataset images",
      ["agent-a", "agent-b", "agent-c"],
      model.id,
    );
    await storeAnnotation(
      { digest: await imageDigest("agent-b"), modelId: model.id },
      [],
      null,
    );

    const train = output(
      await executeAgentOperation("create-dataset", {
        name: "agent-train",
        modelId: model.id,
      }),
    ) as Dataset;
    expect(train).toEqual({
      id: expect.any(String),
      name: "agent-train",
      modelId: model.id,
    });
    expect(
      output(
        await executeAgentOperation("add-images-to-dataset", {
          dataset: train.id,
          images: images.slice(0, 2),
        }),
      ),
    ).toEqual({
      dataset: train,
      added: 2,
      existing: 0,
      unclear: 0,
    });
    expect(
      output(
        await executeAgentOperation("add-images-to-dataset", {
          dataset: train.id,
          images,
        }),
      ),
    ).toMatchObject({ added: 1, existing: 2 });

    expect(
      output(
        await executeAgentOperation("list-datasets", { modelId: model.id }),
      ),
    ).toEqual([
      { dataset: train, imageCount: 3, reviewedCount: 1, trainableCount: 1 },
    ]);

    const [a, b, c] = await Promise.all(
      ["agent-a", "agent-b", "agent-c"].map(imageDigest),
    );
    const contents = output(
      await executeAgentOperation("get-dataset", { dataset: train.id }),
    ) as { images: { digest: string; reviewed: boolean }[] };
    expect(
      contents.images
        .map(({ digest, reviewed }) => ({ digest, reviewed }))
        .sort((x, y) => x.digest.localeCompare(y.digest)),
    ).toEqual(
      [
        { digest: a, reviewed: false },
        { digest: b, reviewed: true },
        { digest: c, reviewed: false },
      ].sort((x, y) => x.digest.localeCompare(y.digest)),
    );

    expect(
      output(
        await executeAgentOperation("remove-images-from-dataset", {
          dataset: train.id,
          digests: [b, b, "0".repeat(64)],
        }),
      ),
    ).toEqual({
      dataset: train,
      removed: 1,
      absent: 1,
    });
    expect(
      output(
        await executeAgentOperation("list-datasets", { modelId: model.id }),
      ),
    ).toMatchObject([{ imageCount: 2, reviewedCount: 0 }]);
    await executeAgentOperation("add-images-to-dataset", {
      dataset: train.id,
      images,
    });
    expect(
      output(
        await executeAgentOperation("list-datasets", { modelId: model.id }),
      ),
    ).toMatchObject([{ imageCount: 3, reviewedCount: 1 }]);

    expect(
      output(
        await executeAgentOperation("update-dataset", {
          dataset: train.id,
          name: "agent-trained",
        }),
      ),
    ).toEqual({ ...train, name: "agent-trained" });
    expect(
      output(
        await executeAgentOperation("list-datasets", { modelId: model.id }),
      ),
    ).toEqual([
      {
        dataset: { ...train, name: "agent-trained" },
        imageCount: 3,
        reviewedCount: 1,
        trainableCount: 1,
      },
    ]);
    const taken = await executeAgentOperation("create-dataset", {
      name: "Agent-Trained",
      modelId: model.id,
    });
    expect(failure(taken).code).toBe("conflict");
    const spare = output(
      await executeAgentOperation("create-dataset", {
        name: "agent-spare",
        modelId: model.id,
      }),
    ) as Dataset;
    const renamedOnto = await executeAgentOperation("update-dataset", {
      dataset: spare.id,
      name: "AGENT-TRAINED",
    });
    expect(failure(renamedOnto).code).toBe("conflict");

    const none = crypto.randomUUID();
    for (const missing of [
      await executeAgentOperation("get-dataset", { dataset: none }),
      await executeAgentOperation("remove-images-from-dataset", {
        dataset: none,
        digests: [a],
      }),
      await executeAgentOperation("add-images-to-dataset", {
        dataset: none,
        images,
      }),
    ]) {
      expect(failure(missing).code).toBe("not_found");
    }

    const version = await baselineVersion();
    const mismatch = await executeAgentOperation("add-images-to-dataset", {
      dataset: train.id,
      images: (
        await observeImagesForModel(
          "Agent dataset other model",
          ["agent-d"],
          version.modelId,
        )
      ).images,
    });
    expect(failure(mismatch).code).toBe("conflict");
  });
});
