import { z } from "zod";

import type { Executor } from "../db/client";
import {
  experimentGridSchema,
  experimentSummarySchema,
  unitRecordSchema,
  unitSeriesSchema,
} from "../experiments/contracts";
import {
  ExperimentNotFoundError,
  UnitNotFoundError,
} from "../experiments/errors";
import {
  cultureEventRequestSchema,
  cultureEventSchema,
  cultureEventRefSchema,
  unitRefSchema,
  unitRequestSchema,
  unitUpdateSchema,
  experimentObservationSchema,
  experimentRefSchema,
  experimentRequestSchema,
  experimentSchema,
  experimentUpdateSchema,
  observationImageAssignmentResultSchema,
  observationImageAssignmentSchema,
  observationImageMoveSchema,
  observationImageRefSchema,
  observationRefSchema,
  observationRequestSchema,
  observationUpdateSchema,
  replicateRequestSchema,
  treatmentRefSchema,
  treatmentRequestSchema,
  treatmentSchema,
  treatmentUpdateSchema,
} from "../experiments/schema";
import { modelSchema, modelVersionSchema } from "../models/schema";
import { recordCultureEvent, deleteCultureEvent } from "./culture-events";
import {
  addReplicates,
  addTreatment,
  createExperiment,
  deleteUnit,
  deleteExperiment,
  deleteTreatment,
  updateUnit,
  updateExperiment,
  updateTreatment,
} from "./experiment-design";
import {
  assignObservationImages,
  moveObservationImage,
  retryObservationImageAnalysis,
  unassignObservationImage,
} from "./experiment-observation-images";
import {
  addObservation,
  deleteObservation,
  updateObservation,
} from "./experiment-observations";
import {
  listExperiments,
  readUnit,
  readExperimentGrid,
} from "./experiment-queries";
import { listAllModelVersions, listModels } from "./model-registry";

/**
 * One protocol-neutral application operation. HTTP status codes and MCP tool
 * annotations are adapter concerns; the catalog says only whether an
 * operation reads or changes state and whether that change is destructive.
 */
export interface AgentOperation {
  name: string;
  description: string;
  kind: "query" | "command";
  destructive: boolean;
  input: z.ZodType;
  output: z.ZodType;
  handler: (input: unknown, executor?: Executor) => Promise<unknown>;
}

interface OperationDefinition<
  Input extends z.ZodType,
  Output extends z.ZodType,
> {
  name: string;
  description: string;
  input: Input;
  output: Output;
  handler: (
    input: z.output<Input>,
    executor?: Executor,
  ) => Promise<z.input<Output> | void>;
}

function defineOperation<Input extends z.ZodType, Output extends z.ZodType>(
  kind: AgentOperation["kind"],
  destructive: boolean,
  config: OperationDefinition<Input, Output>,
): AgentOperation {
  const { name, description, input, output, handler } = config;
  return {
    name,
    description,
    kind,
    destructive,
    input,
    output,
    handler: (value, executor) => handler(value as z.output<Input>, executor),
  };
}

export function query<Input extends z.ZodType, Output extends z.ZodType>(
  config: OperationDefinition<Input, Output>,
): AgentOperation {
  return defineOperation("query", false, config);
}

export function command<Input extends z.ZodType, Output extends z.ZodType>(
  config: OperationDefinition<Input, Output> & { destructive: boolean },
): AgentOperation {
  const { destructive, ...definition } = config;
  return defineOperation("command", destructive, definition);
}

const nothing = z.strictObject({});
const done = z.null();

const operations: readonly AgentOperation[] = [
  query({
    name: "list-experiments",
    description:
      "List every experiment with its design and observation progress",
    input: nothing,
    output: z.array(experimentSummarySchema),
    handler: () => listExperiments(),
  }),
  query({
    name: "list-model-versions",
    description:
      "List the model versions an experiment may be created with, newest first",
    input: nothing,
    output: z.array(
      z.strictObject({
        model: modelSchema,
        version: modelVersionSchema,
      }),
    ),
    handler: async () => {
      const [models, versions] = await Promise.all([
        listModels(),
        listAllModelVersions(),
      ]);
      const byId = new Map(models.map((model) => [model.id, model]));
      return versions.map((version) => {
        const model = byId.get(version.modelId);
        if (!model) {
          throw new Error(`Version ${version.id} refers to no model`);
        }
        return { model, version };
      });
    },
  }),
  query({
    name: "get-experiment",
    description:
      "Read one experiment's full grid: treatments, units, observations, culture events, and per-unit image state",
    input: experimentRefSchema,
    output: experimentGridSchema,
    handler: async ({ experiment }) => {
      const grid = await readExperimentGrid(experiment);
      if (!grid) {
        throw new ExperimentNotFoundError(`Unknown experiment: ${experiment}`);
      }
      return grid;
    },
  }),
  query({
    name: "get-unit",
    description:
      "Read one unit's image series, optionally focused on one observation",
    input: unitRequestSchema,
    output: unitSeriesSchema,
    handler: async ({ observation, ...ref }) => {
      const series = await readUnit(ref, observation);
      if (!series) {
        throw new UnitNotFoundError(
          `Unknown unit: ${ref.unit} in experiment ${ref.experiment}`,
        );
      }
      return series;
    },
  }),
  command({
    name: "create-experiment",
    description:
      "Create an experiment with its design, bound to one immutable model version",
    destructive: false,
    input: experimentRequestSchema,
    output: experimentSchema,
    handler: (input, executor) => createExperiment(input, executor),
  }),
  command({
    name: "update-experiment",
    description:
      "Correct an experiment's name, protocol fields, notes, or inoculation date",
    destructive: true,
    input: experimentUpdateSchema,
    output: experimentSchema,
    handler: (input, executor) => updateExperiment(input, executor),
  }),
  command({
    name: "delete-experiment",
    description:
      "Delete an experiment that has no images and no culture events",
    destructive: true,
    input: experimentRefSchema,
    output: done,
    handler: (input, executor) => deleteExperiment(input, executor),
  }),
  command({
    name: "create-treatment",
    description: "Add a treatment and lay out its replicates",
    destructive: false,
    input: treatmentRequestSchema,
    output: treatmentSchema,
    handler: (input, executor) => addTreatment(input, executor),
  }),
  command({
    name: "add-replicates",
    description: "Lay out more replicates of a treatment",
    destructive: false,
    input: replicateRequestSchema,
    output: z.array(unitRecordSchema),
    handler: (input, executor) => addReplicates(input, executor),
  }),
  command({
    name: "update-treatment",
    description: "Correct a treatment's name, factor, or note",
    destructive: true,
    input: treatmentUpdateSchema,
    output: treatmentSchema,
    handler: (input, executor) => updateTreatment(input, executor),
  }),
  command({
    name: "delete-treatment",
    description:
      "Delete a treatment and its units, none of which may have records",
    destructive: true,
    input: treatmentRefSchema,
    output: done,
    handler: (input, executor) => deleteTreatment(input, executor),
  }),
  command({
    name: "update-unit",
    description:
      "Correct a unit's code or treatment, preserving its identity and records",
    destructive: true,
    input: unitUpdateSchema,
    output: unitRecordSchema,
    handler: (input, executor) => updateUnit(input, executor),
  }),
  command({
    name: "delete-unit",
    description: "Delete a unit that has no images and no culture events",
    destructive: true,
    input: unitRefSchema,
    output: done,
    handler: (input, executor) => deleteUnit(input, executor),
  }),
  command({
    name: "record-culture-event",
    description:
      "Record a culture event on a unit: contaminated, discarded, " +
      "and missing exclude the unit from analysis from that observation on; " +
      "discarded, harvested, and missing take it off the bench afterwards",
    destructive: false,
    input: cultureEventRequestSchema,
    output: cultureEventSchema,
    handler: (input, executor) => recordCultureEvent(input, executor),
  }),
  command({
    name: "remove-culture-event",
    description: "Erase a culture event that was recorded by mistake",
    destructive: true,
    input: cultureEventRefSchema,
    output: done,
    handler: (input, executor) => deleteCultureEvent(input, executor),
  }),
  command({
    name: "create-observation",
    description:
      "Add an observation date to an experiment; it may be planned before images exist",
    destructive: false,
    input: observationRequestSchema,
    output: experimentObservationSchema,
    handler: (input, executor) => addObservation(input, executor),
  }),
  command({
    name: "update-observation",
    description: "Correct an observation's date or note",
    destructive: true,
    input: observationUpdateSchema,
    output: experimentObservationSchema,
    handler: (input, executor) => updateObservation(input, executor),
  }),
  command({
    name: "delete-observation",
    description:
      "Delete an observation that has no images and no culture events",
    destructive: true,
    input: observationRefSchema,
    output: done,
    handler: (input, executor) => deleteObservation(input, executor),
  }),
  command({
    name: "assign-images-to-observation",
    description:
      "Attach stored images to units within one observation; upload bytes first to obtain each digest",
    destructive: false,
    input: observationImageAssignmentSchema,
    output: observationImageAssignmentResultSchema,
    handler: (input, executor) => assignObservationImages(input, executor),
  }),
  command({
    name: "reassign-observation-image",
    description: "Move an observation image to another unit or observation",
    destructive: true,
    input: observationImageMoveSchema,
    output: done,
    handler: (input, executor) => moveObservationImage(input, executor),
  }),
  command({
    name: "unassign-observation-image",
    description:
      "Detach an image from its observation; the stored image itself remains",
    destructive: true,
    input: observationImageRefSchema,
    output: done,
    handler: (input, executor) => unassignObservationImage(input, executor),
  }),
  command({
    name: "retry-observation-image-analysis",
    description: "Queue a failed observation image for analysis again",
    destructive: true,
    input: observationImageRefSchema,
    output: done,
    handler: (input, executor) =>
      retryObservationImageAnalysis(input, executor),
  }),
];

export const agentOperations: ReadonlyMap<string, AgentOperation> = new Map(
  operations.map((operation) => [operation.name, operation]),
);

/** A machine-readable description of every operation, for agent discovery. */
export function describeAgentOperations(): {
  name: string;
  description: string;
  kind: AgentOperation["kind"];
  destructive: boolean;
  input: unknown;
  output: unknown;
}[] {
  return [...agentOperations.values()].map(
    ({ name, description, kind, destructive, input, output }) => ({
      name,
      description,
      kind,
      destructive,
      input: z.toJSONSchema(input, { io: "input" }),
      output: z.toJSONSchema(output, { io: "output" }),
    }),
  );
}
