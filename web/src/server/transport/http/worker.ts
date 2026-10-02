import { createMiddleware } from "@tanstack/react-start";
import type { ZodType } from "zod";

import {
  AnnotationRunConflictError,
  AnnotationRunNotFoundError,
} from "../../annotation-runs/public";

import {
  TrainingArtifactValidationError,
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../../../domain/training/errors";
import {
  workerSessionSchema,
  type WorkerIdentity,
} from "../../../domain/workers/schema";
import {
  DetectionConflictError,
  DetectionImageNotFoundError,
  InvalidDetectionOutcomeError,
  ProducerMismatchError,
  InferenceClaimRejectedError,
} from "../../inference/public";

import { bearerToken } from "../../auth/public";
import {
  WorkerSessionConflictError,
  authenticateWorker,
} from "../../workers/public";

/** A request a worker route refuses before touching any record. */
export class WorkerRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422 = 400,
  ) {
    super(message);
  }
}

/**
 * The worker API answers only to an enrolled worker's token, and hands the
 * worker it proves to the route.
 */
export const requireEnrolledWorker = createMiddleware().server(
  async ({ request, next }) => {
    const token = bearerToken(request);
    const workerId = token ? await authenticateWorker(token) : null;
    if (!workerId) return new Response("Unknown worker token", { status: 401 });
    return next({ context: { workerId } });
  },
);

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

/**
 * A JSON request a worker session makes: the body names the session, and
 * the worker is the one the token proved.
 */
export async function parseWorkerSessionJson<T extends { sessionId: string }>(
  request: Request,
  schema: ZodType<T>,
  workerId: string,
): Promise<T & { workerId: string }> {
  return { ...(await parseWorkerJson(request, schema)), workerId };
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

/** The worker session a request names in its query string. */
export function parseWorkerQuery(
  request: Request,
  workerId: string,
): WorkerIdentity {
  const parsed = workerSessionSchema.safeParse({
    sessionId: new URL(request.url).searchParams.get("sessionId"),
  });
  if (!parsed.success) throw new WorkerRequestError("sessionId is required");
  return { workerId, ...parsed.data };
}

function statusOf(error: unknown): number | null {
  if (error instanceof AnnotationRunConflictError) return 409;
  if (error instanceof AnnotationRunNotFoundError) return 404;
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
