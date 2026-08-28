import { z } from "zod";

const VERSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const versionIdSchema = z.string().regex(VERSION_ID_PATTERN);
export const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const runtimeDescriptorSchema = z.strictObject({
  adapter: z.enum(["traditional", "ultralytics"]),
  fingerprint: fingerprintSchema,
});

export const predictionProducerSchema = z.strictObject({
  model_version_id: versionIdSchema,
  artifact_digest: fingerprintSchema,
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
