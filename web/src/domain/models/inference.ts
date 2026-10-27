import { z } from "zod";

export const inferenceSettingsSchema = z.strictObject({
  confidence: z.number().finite().min(0).max(1),
  imageSize: z.number().int().positive(),
  maxDetections: z.number().int().positive(),
  endToEnd: z.boolean(),
});
