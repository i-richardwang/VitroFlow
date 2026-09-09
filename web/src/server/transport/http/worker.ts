import type { ZodType } from "zod";

import {
  TrainingArtifactValidationError,
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../../../training/errors";
import {
  workerIdentitySchema,
  type WorkerIdentity,
} from "../../../workers/schema";
import {
  DetectionConflictError,
  DetectionImageNotFoundError,
  InvalidDetectionOutcomeError,
  ProducerMismatchError,
  InferenceClaimRejectedError,
} from "../../inference/public";

import { WorkerSessionConflictError } from "../../workers/public";

/** A request a worker route refuses before touching any record. */
export class WorkerRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422 = 400,
  ) {
    super(message);
  }
}

export async function parseWorkerJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new WorkerRequestError("Request body must be valid JSON");
  }
  return parseWorkerValue(value, schema, "Request body");
}

export function parseWorkerJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new WorkerRequestError("Request body must be valid JSON");
  }
}

export async function parseWorkerForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new WorkerRequestError(
      "Request body must be valid multipart form data",
    );
  }
}

export function parseWorkerValue<T>(
  value: unknown,
  schema: ZodType<T>,
  name: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new WorkerRequestError(`${name} is invalid`);
  return parsed.data;
}

/** The worker session a GET names in its query string. */
export function parseWorkerIdentity(
  values: Pick<URLSearchParams, "get">,
): WorkerIdentity {
  const parsed = workerIdentitySchema.safeParse({
    workerId: values.get("workerId"),
    sessionId: values.get("sessionId"),
  });
  if (!parsed.success) {
    throw new WorkerRequestError("workerId and sessionId are required");
  }
  return parsed.data;
}

function statusOf(error: unknown): number | null {
  if (error instanceof WorkerRequestError) return error.status;
  if (
    error instanceof DetectionImageNotFoundError ||
    error instanceof TrainingRunNotFoundError
  ) {
    return 404;
  }
  if (
    error instanceof WorkerSessionConflictError ||
    error instanceof DetectionConflictError ||
    error instanceof InferenceClaimRejectedError ||
    error instanceof TrainingRunConflictError
  ) {
    return 409;
  }
  if (
    error instanceof ProducerMismatchError ||
    error instanceof TrainingArtifactValidationError
  ) {
    return 422;
  }
  if (error instanceof InvalidDetectionOutcomeError) return 400;
  return null;
}

/**
 * The protocol answer for a failure: its message under the status the worker
 * acts on, or the operation name under 500 when the failure is the server's.
 */
export function workerErrorResponse(
  error: unknown,
  operation: string,
): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = statusOf(error);
  if (status !== null) return new Response(message, { status });
  console.error(`${operation}: ${message}`);
  return new Response(operation, { status: 500 });
}
