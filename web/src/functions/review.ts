import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  annotationInstanceSchema,
  annotationRefSchema,
} from "../annotation/schema";
import {
  AnnotationConflictError,
  readAnnotation,
  storeAnnotation,
} from "../server/annotations/public";

export const saveAnnotation = createServerFn({ method: "POST" })
  .validator(
    z.strictObject({
      ref: annotationRefSchema,
      instances: z.array(annotationInstanceSchema),
      base: z.array(annotationInstanceSchema).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    try {
      await storeAnnotation(data.ref, data.instances, data.base);
      return { status: "saved" } as const;
    } catch (error) {
      if (error instanceof AnnotationConflictError) {
        return { status: "conflict" } as const;
      }
      throw error;
    }
  });

/** Reads the stored annotation as a save baseline, independently of the page cache. */
export const getAnnotation = createServerFn({ method: "GET" })
  .validator(annotationRefSchema)
  .handler(({ data }) => readAnnotation(data));
