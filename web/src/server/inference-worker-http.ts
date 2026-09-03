import type { ZodType } from "zod";

import {
  DetectionConflictError,
  DetectionImageNotFoundError,
  InferenceClaimRejectedError,
  InvalidDetectionOutcomeError,
  ProducerMismatchError,
} from "./inference-outcomes";
import {
  InferenceHeartbeatRejectedError,
  InferenceWorkerSessionConflictError,
} from "./inference-worker-store";

export class InferenceHttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

export async function parseInferenceJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new InferenceHttpError(400, "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new InferenceHttpError(400, parsed.error.message);
  }
  return parsed.data;
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export function inferenceWorkerErrorResponse(
  error: unknown,
  operation: string,
): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof InferenceHttpError) {
    return errorResponse(message, error.status);
  }
  if (error instanceof DetectionImageNotFoundError) {
    return errorResponse(message, 404);
  }
  if (
    error instanceof DetectionConflictError ||
    error instanceof InferenceClaimRejectedError ||
    error instanceof InferenceWorkerSessionConflictError
  ) {
    return errorResponse(message, 409);
  }
  if (
    error instanceof ProducerMismatchError ||
    error instanceof InferenceHeartbeatRejectedError
  ) {
    return errorResponse(message, 422);
  }
  if (error instanceof InvalidDetectionOutcomeError) {
    return errorResponse(message, 400);
  }
  console.error(`${operation}: ${message}`);
  return errorResponse(operation, 500);
}
