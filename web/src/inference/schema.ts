import { z } from "zod";

import { resourceIdSchema, sha256Schema } from "../identifiers/schema";

export const runtimeDescriptorSchema = z.strictObject({
  adapter: z.enum(["traditional", "ultralytics"]),
  fingerprint: sha256Schema,
});

export const detectionProducerSchema = z.strictObject({
  model_version_id: resourceIdSchema,
  artifact_digest: sha256Schema,
  runtime: runtimeDescriptorSchema,
});

export type RuntimeDescriptor = z.infer<typeof runtimeDescriptorSchema>;

export function sameRuntimeDescriptor(
  left: RuntimeDescriptor,
  right: RuntimeDescriptor,
): boolean {
  return (
    left.adapter === right.adapter && left.fingerprint === right.fingerprint
  );
}
