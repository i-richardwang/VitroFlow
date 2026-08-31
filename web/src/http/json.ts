import { z } from "zod";

const errorResponseSchema = z.strictObject({ error: z.string().min(1) });

export function parseHttpJson<T>(
  text: string,
  status: number,
  schema: z.ZodType<T>,
): T {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Request failed (${status})`);
  }
  const error = errorResponseSchema.safeParse(body);
  if (error.success) throw new Error(error.data.error);
  if (status < 200 || status >= 300) {
    throw new Error(`Request failed (${status})`);
  }
  return schema.parse(body);
}
