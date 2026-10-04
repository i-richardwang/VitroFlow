import { z } from "zod";

/** A resource id, unanchored, as an HTML `pattern` attribute takes it. */
export const RESOURCE_ID_PATTERN = "[A-Za-z0-9][A-Za-z0-9._-]{0,127}";

export const resourceIdSchema = z
  .string()
  .regex(new RegExp(`^${RESOURCE_ID_PATTERN}$`));

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
