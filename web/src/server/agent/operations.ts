import { z } from "zod";

import { command, query, type AgentOperation } from "./definition";
import { modelOperations } from "./models";
import { trainingOperations } from "./training";
import {
  experimentGridSchema,
  experimentSummarySchema,
  unitSchema,
  unitSeriesSchema,
} from "../../domain/experiments/contracts";
import {
  ExperimentNotFoundError,
  UnitNotFoundError,
} from "../../domain/experiments/errors";
import {
  cultureEventRefSchema,
  cultureEventRequestSchema,
  cultureEventSchema,
  experimentObservationSchema,
  experimentRefSchema,
  experimentRequestSchema,
  experimentSchema,
  experimentUpdateSchema,
  observationImageAssignmentResultSchema,
  observationImageAssignmentSchema,
  observationImageRefSchema,
  observationRefSchema,
  observationRequestSchema,
  observationUpdateSchema,
  replicateRequestSchema,
  treatmentRefSchema,
  treatmentRequestSchema,
  treatmentSchema,
  treatmentUpdateSchema,
  unitRefSchema,
  unitRequestSchema,
  unitUpdateSchema,
} from "../../domain/experiments/schema";
import { DatasetNotFoundError } from "../../domain/datasets/errors";
import {
  datasetContentsSchema,
  datasetImageAdditionResultSchema,
  datasetImageAdditionSchema,
  datasetImageRemovalResultSchema,
  datasetImageRemovalSchema,
  datasetListRequestSchema,
  datasetRefSchema,
  datasetRequestSchema,
  datasetSchema,
  datasetSummarySchema,
  datasetUpdateSchema,
} from "../../domain/datasets/schema";
import {
  modelRefSchema,
  modelAnnotationRequestSchema,
  modelRequestSchema,
  modelSchema,
} from "../../domain/models/schema";
import {
  recordCultureEvent,
  deleteCultureEvent,
  addReplicates,
  addTreatment,
  createExperiment,
  deleteExperiment,
  deleteTreatment,
  deleteUnit,
  updateExperiment,
  updateTreatment,
  updateUnit,
  assignObservationImages,
  retryObservationImageAnalysis,
  unassignObservationImage,
  addObservation,
  deleteObservation,
  updateObservation,
  listExperiments,
  readExperimentGrid,
  readUnit,
} from "../experiments/public";

import {
  addExperimentObservationImages,
  createDataset,
  listDatasetSummaries,
  updateDataset,
  readDatasetContents,
  removeDatasetImages,
} from "../datasets/public";
import {
  createModel,
  deleteModel,
  listModels,
  setModelAnnotation,
} from "../models/public";

const nothing = z.strictObject({});
const done = z.null();

const operations: readonly AgentOperation[] = [
  ...modelOperations,
  ...trainingOperations,
  query({
    name: "list-experiments",
    description:
      "List every experiment with its design and observation progress",
    input: nothing,
    output: z.array(experimentSummarySchema),
    handler: () => listExperiments(),
  }),
  query({
    name: "list-models",
    description:
      "List the recognition tasks an observation may be read for, and the classes each one finds",
    input: nothing,
    output: z.array(modelSchema),
    handler: () => listModels(),
  }),
  command({
    name: "create-model",
    description:
      "Name a recognition task the workbench does not have yet, with the classes a reviewer will draw. It can be observed and annotated straight away; a version to detect it comes later, from training",
    destructive: false,
    input: modelRequestSchema,
    output: modelSchema,
    handler: (input) => createModel(input),
  }),
  command({
    name: "update-model-annotation",
    description:
      "Change how an AI agent annotates a recognition task: the instructions describing the bodies to box, and the source region each look takes. The classes stay fixed",
    destructive: true,
    input: modelAnnotationRequestSchema,
    output: modelSchema,
    handler: (input) => setModelAnnotation(input),
  }),
  command({
    name: "delete-model",
    description: "Forget a recognition task nothing has recorded against yet",
    destructive: true,
    input: modelRefSchema,
    output: done,
    handler: async (input) => {
      await deleteModel(input);
      return null;
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
    description: "Create an experiment with its design",
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
    output: z.array(unitSchema),
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
      "Delete a treatment and its units; the last treatment and recorded units stay",
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
    output: unitSchema,
    handler: (input, executor) => updateUnit(input, executor),
  }),
  command({
    name: "delete-unit",
    description:
      "Delete a unit that has no records and is not its treatment's last replicate",
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
      "Add an observation to an experiment: the date and the recognition task its images are read for; it may be planned before images exist",
    destructive: false,
    input: observationRequestSchema,
    output: experimentObservationSchema,
    handler: (input, executor) => addObservation(input, executor),
  }),
  command({
    name: "update-observation",
    description:
      "Correct an observation's date, note, or recognition task; images already taken are read again for the new one",
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
      "Assign stored images to units in one observation; a cell that already has an image is given the new one; upload bytes first to obtain each digest",
    destructive: false,
    input: observationImageAssignmentSchema,
    output: observationImageAssignmentResultSchema,
    handler: (input, executor) => assignObservationImages(input, executor),
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
  query({
    name: "list-datasets",
    description:
      "List the datasets that train each recognition task, optionally for one model, with each one's id and name, how many images it holds, and how many of those are reviewed; training uses only reviewed images",
    input: datasetListRequestSchema,
    output: z.array(datasetSummarySchema),
    handler: ({ modelId }) => listDatasetSummaries(modelId),
  }),
  command({
    name: "create-dataset",
    description:
      "Create an empty dataset that trains one recognition task; its name is unique whatever its case and stays filename-safe, because transfer and data roots know a dataset by name",
    destructive: false,
    input: datasetRequestSchema,
    output: datasetSchema,
    handler: (input, executor) => createDataset(input, executor),
  }),
  command({
    name: "update-dataset",
    description:
      "Rename a dataset; its images, training splits, snapshots, and runs stay with it",
    destructive: true,
    input: datasetUpdateSchema,
    output: datasetSchema,
    handler: (input, executor) => updateDataset(input, executor),
  }),
  query({
    name: "get-dataset",
    description:
      "Read one dataset's images by digest, each with whether it is reviewed and the training split a snapshot gave it; match digests against get-experiment's image cells to see where an image was observed",
    input: datasetRefSchema,
    output: datasetContentsSchema,
    handler: async ({ dataset }) => {
      const contents = await readDatasetContents(dataset);
      if (!contents) {
        throw new DatasetNotFoundError(`Unknown dataset: ${dataset}`);
      }
      return contents;
    },
  }),
  command({
    name: "add-images-to-dataset",
    description:
      "Add experiment observation images to a dataset that trains their observation's model. All images must be observed for that model; images already in the dataset are counted as existing, so repeating a call is safe. Training splits are assigned when a snapshot is taken",
    destructive: false,
    input: datasetImageAdditionSchema,
    output: datasetImageAdditionResultSchema,
    handler: (input, executor) =>
      addExperimentObservationImages(input, executor),
  }),
  command({
    name: "remove-images-from-dataset",
    description:
      "Take images out of a dataset by digest so later training leaves them out. The images, their reviews, and snapshots already taken remain; digests not in the dataset are counted as absent, so repeating a call is safe",
    destructive: true,
    input: datasetImageRemovalSchema,
    output: datasetImageRemovalResultSchema,
    handler: (input, executor) => removeDatasetImages(input, executor),
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
