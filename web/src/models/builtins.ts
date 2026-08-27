import { z } from "zod";

import traditionalManifest from "../../../configs/traditional-v1.json";
import { fingerprintSchema } from "../inference/schema";

const traditionalManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  definition: z.literal("traditional-v1"),
  createdAt: z.string().datetime({ offset: true }),
  artifactDigest: fingerprintSchema,
});

export const TRADITIONAL_MODEL_MANIFEST =
  traditionalManifestSchema.parse(traditionalManifest);
