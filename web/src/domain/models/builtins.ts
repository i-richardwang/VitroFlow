import { z } from "zod";

import traditionalManifest from "../../../../configs/traditional-v1.json";
import { sha256Schema } from "../identifiers/schema";
import {
  DEFAULT_MODEL_ANNOTATION,
  modelSchema,
  modelVersionSchema,
} from "./schema";

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
export const SEED_DETECTOR_BASELINE_VERSION_ID = "traditional-v1";

export const SEED_ANNOTATION_INSTRUCTIONS = `Annotate each seed body separately, including opaque brown/gold
and pale yellow/translucent bodies with a coherent elongated outline. Enclose the
complete visible body, including pale coat and tips, before minimizing background.
Distinguish seed bodies from fibers and glare. Inspect touching clusters for
separate bodies at different angles; their rectangles may overlap naturally.
Do not force an expected count or mechanically shrink, expand or pad boxes.`;

export const SEED_DETECTOR = modelSchema.parse({
  schemaVersion: 1,
  id: SEED_DETECTOR_MODEL_ID,
  name: "Seed detector",
  task: "object_detection",
  classes: ["seed"],
  annotation: {
    ...DEFAULT_MODEL_ANNOTATION,
    instructions: SEED_ANNOTATION_INSTRUCTIONS,
  },
});

export const SEED_DETECTOR_BASELINE = modelVersionSchema.parse({
  schemaVersion: 1,
  id: SEED_DETECTOR_BASELINE_VERSION_ID,
  modelId: SEED_DETECTOR_MODEL_ID,
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
