import { z } from "zod";

import {
  prelabelerDescriptorSchema,
  samePrelabelerDescriptor,
  versionIdSchema,
  type PrelabelerDescriptor,
} from "../prelabelers/schema";

export const modelSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: versionIdSchema,
  name: z.string().min(1),
  task: z.literal("object_detection"),
  classes: z.tuple([z.literal("seed")]),
});

export const modelVersionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: versionIdSchema,
    modelId: versionIdSchema,
    prelabeler: prelabelerDescriptorSchema,
  })
  .refine((version) => version.id === version.prelabeler.version_id, {
    message: "Model version id must match its prelabeler version id",
    path: ["prelabeler", "version_id"],
  });

export type Model = z.infer<typeof modelSchema>;
export type ModelVersion = z.infer<typeof modelVersionSchema>;

export function sameModelVersion(
  left: ModelVersion,
  right: ModelVersion,
): boolean {
  return (
    left.id === right.id &&
    left.modelId === right.modelId &&
    samePrelabelerDescriptor(left.prelabeler, right.prelabeler)
  );
}

export function modelVersionFromPrelabeler(
  modelId: string,
  prelabeler: PrelabelerDescriptor,
): ModelVersion {
  return modelVersionSchema.parse({
    schemaVersion: 1,
    id: prelabeler.version_id,
    modelId,
    prelabeler,
  });
}
