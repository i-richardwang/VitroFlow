import { z } from "zod";

import { resourceIdSchema } from "../identifiers/schema";
import { imageDigestSchema } from "../images/schema";
import { classListSchema } from "../models/readings";
import {
  modelArtifactSchema,
  type Model,
  type ModelVersion,
} from "../models/schema";

/** The immutable inputs an Inference Worker needs to execute one version. */
export const inferenceModelManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  modelVersionId: resourceIdSchema,
  classes: classListSchema,
  artifact: modelArtifactSchema,
});

/** One Server assignment: a loadable model and the images to run through it. */
export const inferenceAssignmentSchema = z.strictObject({
  manifest: inferenceModelManifestSchema,
  images: z.array(imageDigestSchema).min(1),
});

export type InferenceModelManifest = z.infer<
  typeof inferenceModelManifestSchema
>;
export type InferenceAssignment = z.infer<typeof inferenceAssignmentSchema>;

export function inferenceModelManifest(
  version: Pick<ModelVersion, "id" | "artifact">,
  model: Pick<Model, "classes">,
): InferenceModelManifest {
  return inferenceModelManifestSchema.parse({
    schemaVersion: 1,
    modelVersionId: version.id,
    classes: model.classes,
    artifact: version.artifact,
  });
}
