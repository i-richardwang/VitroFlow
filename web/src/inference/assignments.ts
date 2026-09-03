import { z } from "zod";

import { resourceIdSchema } from "../identifiers/schema";
import { imageDigestSchema } from "../images/schema";
import { classListSchema } from "../models/metrics";
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

/** One leased task: a loadable model and the image to run through it. */
export const inferenceAssignmentSchema = z.strictObject({
  manifest: inferenceModelManifestSchema,
  image: imageDigestSchema,
  leaseExpiresAt: z.string().datetime({ offset: true }),
});

/** The durable image/version pair named by inference routes. */
export const inferenceTargetSchema = z.strictObject({
  versionId: resourceIdSchema,
  digest: imageDigestSchema,
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
