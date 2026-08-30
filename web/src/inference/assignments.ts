import { z } from "zod";

import { imageDigestSchema } from "../datasets/schema";
import { modelArtifactSchema, type ModelVersion } from "../models/schema";
import { versionIdSchema } from "./schema";

/** The immutable inputs an Inference Worker needs to execute one version. */
export const inferenceModelManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  modelVersionId: versionIdSchema,
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
): InferenceModelManifest {
  return inferenceModelManifestSchema.parse({
    schemaVersion: 1,
    modelVersionId: version.id,
    artifact: version.artifact,
  });
}
