import { z } from "zod";

import traditionalManifest from "../../../configs/traditional-v1.json";
import { sha256Schema } from "../identifiers/schema";
import { modelSchema, modelVersionSchema } from "./schema";

const traditionalManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  definition: z.literal("traditional-v1"),
  createdAt: z.string().datetime({ offset: true }),
  artifactDigest: sha256Schema,
});

export const TRADITIONAL_MODEL_MANIFEST =
  traditionalManifestSchema.parse(traditionalManifest);

/**
 * Models are the tasks the workbench reads: one logical model per
 * purpose, each with many versions. Seed detection ships with the package as
 * a traditional detector, so a deployment can read from its first minute; every
 * trained version joins the same model and replaces nothing.
 */
export const SEED_DETECTOR_MODEL_ID = "seed-detector";
export const SEED_DETECTOR_BASELINE_VERSION_ID = `${SEED_DETECTOR_MODEL_ID}.traditional-v1`;

export const SEED_DETECTOR = modelSchema.parse({
  schemaVersion: 1,
  id: SEED_DETECTOR_MODEL_ID,
  name: "Seed detector",
  task: "object_detection",
  classes: ["seed"],
  readings: [{ id: "seeds", name: "Seeds", kind: "count", classes: ["seed"] }],
});

export const SEED_DETECTOR_BASELINE = modelVersionSchema.parse({
  schemaVersion: 1,
  id: SEED_DETECTOR_BASELINE_VERSION_ID,
  modelId: SEED_DETECTOR_MODEL_ID,
  name: "Traditional vision baseline",
  createdAt: TRADITIONAL_MODEL_MANIFEST.createdAt,
  source: {
    kind: "builtin",
    definition: TRADITIONAL_MODEL_MANIFEST.definition,
  },
  artifact: {
    kind: "traditional",
    digest: TRADITIONAL_MODEL_MANIFEST.artifactDigest,
  },
});
