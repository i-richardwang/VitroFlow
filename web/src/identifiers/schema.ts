import { z } from "zod";

/** Stable identifiers carried in URLs, manifests, and database keys. */
export const resourceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);

/** A lowercase hexadecimal SHA-256 content digest. */
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
