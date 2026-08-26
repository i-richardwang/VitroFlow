import { z } from "zod";

export const VERSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const versionIdSchema = z.string().regex(VERSION_ID_PATTERN);
export const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const prelabelerDescriptorSchema = z.strictObject({
  version_id: versionIdSchema,
  name: z.string().min(1),
  kind: versionIdSchema,
  fingerprint: fingerprintSchema,
});

export const registeredPrelabelerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  descriptor: prelabelerDescriptorSchema,
});

export type PrelabelerDescriptor = z.infer<typeof prelabelerDescriptorSchema>;

export function samePrelabelerDescriptor(
  left: PrelabelerDescriptor,
  right: PrelabelerDescriptor,
): boolean {
  return (
    left.version_id === right.version_id &&
    left.name === right.name &&
    left.kind === right.kind &&
    left.fingerprint === right.fingerprint
  );
}
