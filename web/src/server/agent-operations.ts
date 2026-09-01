import type { ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  experimentGridSchema,
  experimentSummarySchema,
  observationUnitRecordSchema,
  observationUnitSeriesSchema,
} from "../experiments/contracts";
import { cultureEventExcludesFromAnalysisByDefault } from "../experiments/culture-events";
import {
  ConflictError,
  ExperimentNotFoundError,
  NotFoundError,
  ObservationUnitNotFoundError,
} from "../experiments/errors";
import {
  CULTURE_EVENT_TYPES,
  observationUnitAssignmentSchema,
  cultureEventRequestSchema,
  cultureEventSchema,
  cultureEventVoidSchema,
  observationUnitBatchSchema,
  observationUnitRefSchema,
  observationUnitRequestSchema,
  observationUnitUpdateSchema,
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
  treatmentRefSchema,
  treatmentRequestSchema,
  treatmentSchema,
  treatmentUpdateSchema,
} from "../experiments/schema";
import { modelSchema, modelVersionSchema } from "../models/schema";
import { recordCultureEvent, voidCultureEvent } from "./culture-events";
import {
  addObservationUnits,
  addTreatment,
  assignObservationUnits,
  createExperiment,
  deleteObservationUnit,
  deleteExperiment,
  deleteTreatment,
  updateObservationUnit,
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
  readObservationUnit,
  readExperimentGrid,
} from "./experiment-queries";
import { listAllModelVersions, listModels } from "./model-registry";

/**
 * The outcome of one agent operation call. The registry boundary alone
 * decides how a call went: it validates the input, classifies what the
 * domain layer threw, enforces the output contract, and sanitizes defects.
 * The HTTP and MCP surfaces project this closed union onto their protocols
 * without judging it.
 */
export type AgentCallResult =
  | { ok: true; output: unknown }
  | { ok: false; status: 400 | 404 | 409 | 500; message: string };

/**
 * One experiment-maintenance operation exposed to data-entry agents. Each
 * binds a request schema to the domain function it validates for, so every
 * business invariant lives in the domain layer and this table stays a
 * projection. The HTTP surface and the MCP tool list are both derived from
 * it, and an operation name is part of the public contract.
 */
export interface AgentOperation {
  name: string;
  description: string;
  annotations: ToolAnnotations;
  input: z.ZodType;
  output: z.ZodType;
  run: (input: unknown) => Promise<AgentCallResult>;
}

export function operation<
  Input extends z.ZodType,
  Output extends z.ZodType,
>(config: {
  name: string;
  description: string;
  annotations: ToolAnnotations;
  input: Input;
  output: Output;
  handler: (input: z.output<Input>) => Promise<z.input<Output> | void>;
}): AgentOperation {
  const { name, description, annotations, input, output, handler } = config;
  return {
    name,
    description,
    annotations,
    input,
    output,
    run: async (value) => {
      const request = input.safeParse(value);
      if (!request.success) {
        return {
          ok: false,
          status: 400,
          message: z.prettifyError(request.error),
        };
      }
      try {
        const result = (await handler(request.data)) ?? null;
        return { ok: true, output: output.parse(result) };
      } catch (error) {
        if (error instanceof NotFoundError) {
          return { ok: false, status: 404, message: error.message };
        }
        if (error instanceof ConflictError) {
          return { ok: false, status: 409, message: error.message };
        }
        console.error(`Agent operation ${name} failed:`, error);
        return { ok: false, status: 500, message: "Internal error" };
      }
    },
  };
}

const READS: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const CREATES: ToolAnnotations = {
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const MUTATES: ToolAnnotations = {
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

const nothing = z.strictObject({});
const done = z.null();

const excludedByDefault = CULTURE_EVENT_TYPES.filter((type) =>
  cultureEventExcludesFromAnalysisByDefault(type),
);
const includedByDefault = CULTURE_EVENT_TYPES.filter(
  (type) => !cultureEventExcludesFromAnalysisByDefault(type),
);

const operations: readonly AgentOperation[] = [
  operation({
    name: "list-experiments",
    description:
      "List every experiment with its design and observation progress",
    annotations: READS,
    input: nothing,
    output: z.array(experimentSummarySchema),
    handler: () => listExperiments(),
  }),
  operation({
    name: "list-model-versions",
    description:
      "List the model versions an experiment may be created with, newest first",
    annotations: READS,
    input: nothing,
    output: z.array(
      z.strictObject({
        model: modelSchema.nullable(),
        version: modelVersionSchema,
      }),
    ),
    handler: async () => {
      const [models, versions] = await Promise.all([
        listModels(),
        listAllModelVersions(),
      ]);
      const byId = new Map(models.map((model) => [model.id, model]));
      return versions.map((version) => ({
        model: byId.get(version.modelId) ?? null,
        version,
      }));
    },
  }),
  operation({
    name: "get-experiment",
    description:
      "Read one experiment's full grid: treatments, observation units, observations, culture events, and per-unit image state",
    annotations: READS,
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
  operation({
    name: "get-observation-unit",
    description:
      "Read one observation unit's image series, optionally focused on one observation",
    annotations: READS,
    input: observationUnitRequestSchema,
    output: observationUnitSeriesSchema,
    handler: async ({ observation, ...ref }) => {
      const series = await readObservationUnit(ref, observation);
      if (!series) {
        throw new ObservationUnitNotFoundError(
          `Unknown observation unit: ${ref.observationUnit} in experiment ${ref.experiment}`,
        );
      }
      return series;
    },
  }),
  operation({
    name: "create-experiment",
    description: "Create an experiment bound to one immutable model version",
    annotations: CREATES,
    input: experimentRequestSchema,
    output: experimentSchema,
    handler: (input) => createExperiment(input),
  }),
  operation({
    name: "update-experiment",
    description:
      "Correct an experiment's name, protocol fields, notes, or inoculation date",
    annotations: MUTATES,
    input: experimentUpdateSchema,
    output: experimentSchema,
    handler: (input) => updateExperiment(input),
  }),
  operation({
    name: "delete-experiment",
    description:
      "Delete an experiment that has no images and no culture events",
    annotations: MUTATES,
    input: experimentRefSchema,
    output: done,
    handler: (input) => deleteExperiment(input),
  }),
  operation({
    name: "create-treatment",
    description: "Add a treatment, optionally generating its observation units",
    annotations: CREATES,
    input: treatmentRequestSchema,
    output: treatmentSchema,
    handler: (input) => addTreatment(input),
  }),
  operation({
    name: "update-treatment",
    description: "Correct a treatment's name, factor, or note",
    annotations: MUTATES,
    input: treatmentUpdateSchema,
    output: treatmentSchema,
    handler: (input) => updateTreatment(input),
  }),
  operation({
    name: "delete-treatment",
    description: "Delete a treatment; its observation units become unassigned",
    annotations: MUTATES,
    input: treatmentRefSchema,
    output: done,
    handler: (input) => deleteTreatment(input),
  }),
  operation({
    name: "create-observation-units",
    description:
      "Add observation units by their dish codes, optionally under a treatment",
    annotations: CREATES,
    input: observationUnitBatchSchema,
    output: z.array(observationUnitRecordSchema),
    handler: (input) => addObservationUnits(input),
  }),
  operation({
    name: "update-observation-unit",
    description:
      "Correct an observation unit's code, preserving its identity and records",
    annotations: MUTATES,
    input: observationUnitUpdateSchema,
    output: observationUnitRecordSchema,
    handler: (input) => updateObservationUnit(input),
  }),
  operation({
    name: "delete-observation-unit",
    description:
      "Delete an observation unit that has no images and no culture events",
    annotations: MUTATES,
    input: observationUnitRefSchema,
    output: done,
    handler: (input) => deleteObservationUnit(input),
  }),
  operation({
    name: "assign-observation-units",
    description:
      "Assign observation units to a treatment, or clear their assignment",
    annotations: MUTATES,
    input: observationUnitAssignmentSchema,
    output: done,
    handler: (input) => assignObservationUnits(input),
  }),
  operation({
    name: "record-culture-event",
    description:
      "Record a culture event on an observation unit. When excludeFromObservation " +
      `is omitted, the event type's default applies: ${excludedByDefault.join(", ")} ` +
      `exclude the unit from analysis; ${includedByDefault.join(", ")} keep it included`,
    annotations: CREATES,
    input: cultureEventRequestSchema,
    output: cultureEventSchema,
    handler: (input) => recordCultureEvent(input),
  }),
  operation({
    name: "void-culture-event",
    description: "Void a mistakenly recorded culture event",
    annotations: MUTATES,
    input: cultureEventVoidSchema,
    output: cultureEventSchema,
    handler: (input) => voidCultureEvent(input),
  }),
  operation({
    name: "create-observation",
    description:
      "Add an observation date to an experiment; it may be planned before images exist",
    annotations: CREATES,
    input: observationRequestSchema,
    output: experimentObservationSchema,
    handler: (input) => addObservation(input),
  }),
  operation({
    name: "update-observation",
    description: "Correct an observation's date or note",
    annotations: MUTATES,
    input: observationUpdateSchema,
    output: experimentObservationSchema,
    handler: (input) => updateObservation(input),
  }),
  operation({
    name: "delete-observation",
    description:
      "Delete an observation that has no images and no culture events",
    annotations: MUTATES,
    input: observationRefSchema,
    output: done,
    handler: (input) => deleteObservation(input),
  }),
  operation({
    name: "assign-images-to-observation",
    description:
      "Attach stored images to observation units within one observation; upload bytes first to obtain each digest",
    annotations: CREATES,
    input: observationImageAssignmentSchema,
    output: observationImageAssignmentResultSchema,
    handler: (input) => assignObservationImages(input),
  }),
  operation({
    name: "reassign-observation-image",
    description:
      "Move an observation image to another observation unit or observation",
    annotations: MUTATES,
    input: observationImageMoveSchema,
    output: done,
    handler: (input) => moveObservationImage(input),
  }),
  operation({
    name: "unassign-observation-image",
    description:
      "Detach an image from its observation; the stored image itself remains",
    annotations: MUTATES,
    input: observationImageRefSchema,
    output: done,
    handler: (input) => unassignObservationImage(input),
  }),
  operation({
    name: "retry-observation-image-analysis",
    description: "Queue a failed observation image for analysis again",
    annotations: MUTATES,
    input: observationImageRefSchema,
    output: done,
    handler: (input) => retryObservationImageAnalysis(input),
  }),
];

export const agentOperations: ReadonlyMap<string, AgentOperation> = new Map(
  operations.map((operation) => [operation.name, operation]),
);

export async function callAgentOperation(
  name: string,
  input: unknown,
  registry: ReadonlyMap<string, AgentOperation> = agentOperations,
): Promise<AgentCallResult> {
  const found = registry.get(name);
  if (!found) {
    return {
      ok: false,
      status: 404,
      message: `Unknown operation: ${name}. Known operations: ${[...registry.keys()].join(", ")}`,
    };
  }
  return found.run(input);
}

/** A machine-readable description of every operation, for agent discovery. */
export function describeAgentOperations(): {
  name: string;
  description: string;
  annotations: ToolAnnotations;
  input: unknown;
  output: unknown;
}[] {
  return [...agentOperations.values()].map(
    ({ name, description, annotations, input, output }) => ({
      name,
      description,
      annotations,
      input: z.toJSONSchema(input, { io: "input", unrepresentable: "any" }),
      output: z.toJSONSchema(output, { io: "output", unrepresentable: "any" }),
    }),
  );
}
