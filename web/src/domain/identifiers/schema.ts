import { z } from "zod";

export const resourceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
