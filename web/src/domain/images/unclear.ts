import { z } from "zod";

import { imageDigestSchema } from "./schema";

/*
 * A photograph a person could not read clearly, such as a fogged lid or a
 * dish out of focus, is marked unclear. The mark belongs to the canonical
 * image, not to the experiment, unit, observation or model that shows it, and
 * an image without one is clear. Whether an unclear photograph's number
 * counts is each experiment's rule, and datasets train on it as on any other.
 */

/** Whether marking added a mark; an image already marked keeps the one it has. */
export const unclearMarkedSchema = z.strictObject({
  digest: imageDigestSchema,
  marked: z.boolean(),
});

export type UnclearMarked = z.infer<typeof unclearMarkedSchema>;

/** Whether clearing a mark removed one; an image never marked had none to remove. */
export const unclearClearedSchema = z.strictObject({
  digest: imageDigestSchema,
  cleared: z.boolean(),
});

export type UnclearCleared = z.infer<typeof unclearClearedSchema>;
