import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  annotationInstanceSchema,
  annotationRefSchema,
} from "../annotation/schema";
import { storeAnnotation } from "../server/annotations";

export const saveAnnotation = createServerFn({ method: "POST" })
  .validator(
    z.strictObject({
      ref: annotationRefSchema,
      instances: z.array(annotationInstanceSchema),
    }),
  )
  .handler(({ data }) => storeAnnotation(data.ref, data.instances));
