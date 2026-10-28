import { z } from "zod";

import { imageDigestSchema } from "./schema";

/*
 * A photograph a person could not read clearly, such as a fogged lid or a
 * dish out of focus, is marked unclear. The mark belongs to the canonical
 * image, not to the experiment, unit, observation or model that shows it, and
 * an image without one is clear. Whether its number still counts is the
 * person's call: an unclear photograph is not counted unless they say it is.
 */

/** The most a mark's note holds. */
export const UNCLEAR_NOTE_LENGTH = 500;

/** What makes the photograph unclear, in the person's words; may be empty. */
const unclearNoteSchema = z
  .string()
  .trim()
  .max(
    UNCLEAR_NOTE_LENGTH,
    `Unclear note must be at most ${UNCLEAR_NOTE_LENGTH} characters`,
  );

/** What a person says when marking a photograph unclear. */
export const unclearDecisionSchema = z.strictObject({
  /** Whether the photograph's number is still trusted. */
  counted: z.boolean().default(false),
  note: unclearNoteSchema.default(""),
});

export type UnclearDecision = z.infer<typeof unclearDecisionSchema>;

/** The mark an unclear photograph carries: the decision, and when it was made. */
export const unclearMarkSchema = z.strictObject({
  counted: z.boolean(),
  note: unclearNoteSchema,
  recordedAt: z.string().datetime({ offset: true }),
});

export type UnclearMark = z.infer<typeof unclearMarkSchema>;

/** Marks one stored image unclear, or changes the mark it has. */
export const unclearImageRequestSchema = unclearDecisionSchema.extend({
  digest: imageDigestSchema,
});

export type UnclearImageRequest = z.infer<typeof unclearImageRequestSchema>;

/** A mark as it stands after marking: the image it is on, and what it says. */
export const unclearImageSchema = unclearMarkSchema.extend({
  digest: imageDigestSchema,
});

export type UnclearImage = z.infer<typeof unclearImageSchema>;

/** Whether clearing a mark removed one; an image never marked had none to remove. */
export const unclearClearedSchema = z.strictObject({
  digest: imageDigestSchema,
  cleared: z.boolean(),
});

export type UnclearCleared = z.infer<typeof unclearClearedSchema>;

/**
 * Whether a photograph's number is trusted: a clear one's is, and an unclear
 * one's only when the person who marked it counted it anyway.
 */
export function numberTrusted(
  mark: Pick<UnclearMark, "counted"> | null,
): boolean {
  return mark === null || mark.counted;
}
