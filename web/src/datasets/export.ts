import { z } from "zod";

import { annotationSchema } from "../annotation/schema";
import { detectionResultSchema } from "../detection/schema";
import { resourceIdSchema } from "../identifiers/schema";
import { imageDigestSchema } from "../images/schema";
import { classListSchema } from "../models/metrics";
import { IMAGE_SPLITS } from "../training/schema";
import { datasetIdSchema } from "./schema";

const datasetExportImageSchema = z
  .strictObject({
    digest: imageDigestSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    filename: z.string().min(1),
    bytes: z.number().int().positive(),
    split: z.enum(IMAGE_SPLITS).nullable(),
    detection: detectionResultSchema.nullable(),
    annotation: annotationSchema.nullable(),
  })
  .superRefine((image, context) => {
    for (const [field, document] of [
      ["detection", image.detection],
      ["annotation", image.annotation],
    ] as const) {
      if (!document) continue;
      if (document.image.digest !== image.digest) {
        context.addIssue({
          code: "custom",
          path: [field, "image", "digest"],
          message: `${field} describes another image`,
        });
      }
      if (
        document.image.width !== image.width ||
        document.image.height !== image.height
      ) {
        context.addIssue({
          code: "custom",
          path: [field, "image"],
          message: `${field} dimensions differ from the image`,
        });
      }
    }
  });

export const datasetExportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    dataset: datasetIdSchema,
    model: z.strictObject({
      id: resourceIdSchema,
      classes: classListSchema,
    }),
    images: z.array(datasetExportImageSchema),
  })
  .superRefine((dataset, context) => {
    const classes = new Set(dataset.model.classes);
    dataset.images.forEach((image, imageIndex) => {
      for (const field of ["detection", "annotation"] as const) {
        image[field]?.instances.forEach((instance, instanceIndex) => {
          if (classes.has(instance.class)) return;
          context.addIssue({
            code: "custom",
            path: [
              "images",
              imageIndex,
              field,
              "instances",
              instanceIndex,
              "class",
            ],
            message: `${field} uses unknown class ${instance.class}`,
          });
        });
      }
    });
  });

export type DatasetExport = z.infer<typeof datasetExportSchema>;
