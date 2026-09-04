import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { annotationSchema, annotationRefSchema } from "../annotation/schema";
import { saveAnnotation } from "../server/annotations";

export const saveReview = createServerFn({ method: "POST" })
  .validator(
    z.strictObject({ ref: annotationRefSchema, document: annotationSchema }),
  )
  .handler(({ data }) => saveAnnotation(data.ref, data.document));
