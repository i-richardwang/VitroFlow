import type { ZodType } from "zod";

import {
  TrainingArtifactValidationError,
  TrainingRunConflictError,
  TrainingRunNotFoundError,
  TrainingWorkerSessionConflictError,
} from "../training/errors";
import {
  trainingWorkerIdentitySchema,
  type TrainingWorkerIdentity,
} from "../training/workers";

export class TrainingRequestError extends Error {}

export async function parseTrainingJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new TrainingRequestError("Request body must be valid JSON");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new TrainingRequestError(parsed.error.message);
  return parsed.data;
}

export function parseTrainingJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new TrainingRequestError("Request body must be valid JSON");
  }
}

export async function parseTrainingForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new TrainingRequestError(
      "Request body must be valid multipart form data",
    );
  }
}

export function parseTrainingValue<T>(
  value: unknown,
  schema: ZodType<T>,
  name: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new TrainingRequestError(`${name} is invalid`);
  return parsed.data;
}

export function parseTrainingWorkerIdentity(
  values: Pick<URLSearchParams, "get">,
): TrainingWorkerIdentity {
  const parsed = trainingWorkerIdentitySchema.safeParse({
    workerId: values.get("workerId"),
    sessionId: values.get("sessionId"),
  });
  if (!parsed.success) {
    throw new TrainingRequestError("workerId and sessionId are required");
  }
  return parsed.data;
}

export function trainingWorkerErrorResponse(
  error: unknown,
  operation: string,
): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof TrainingRequestError) {
    return new Response(message, { status: 400 });
  }
  if (error instanceof TrainingRunNotFoundError) {
    return new Response(message, { status: 404 });
  }
  if (
    error instanceof TrainingRunConflictError ||
    error instanceof TrainingWorkerSessionConflictError
  ) {
    return new Response(message, { status: 409 });
  }
  if (error instanceof TrainingArtifactValidationError) {
    return new Response(message, { status: 422 });
  }
  console.error(`${operation}: ${message}`);
  return new Response(operation, { status: 500 });
}
