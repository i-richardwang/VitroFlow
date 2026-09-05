import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  annotationInstanceSchema,
  annotationRefSchema,
} from "../annotation/schema";
import { saveAnnotation } from "../server/annotations";

export const saveReview = createServerFn({ method: "POST" })
  .validator(
    z.strictObject({
      ref: annotationRefSchema,
      instances: z.array(annotationInstanceSchema),
    }),
  )
  .handler(({ data }) => saveAnnotation(data.ref, data.instances));
