import { secretsEqual } from "./secrets";

function hasBearerToken(
  request: Request,
  expected: string | undefined,
): boolean {
  if (!expected) {
    return false;
  }
  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  return (
    authorization.startsWith(prefix) &&
    secretsEqual(authorization.slice(prefix.length), expected)
  );
}

export function isInferenceWorkerAuthenticated(request: Request): boolean {
  return hasBearerToken(request, process.env.VITROFLOW_INFERENCE_WORKER_TOKEN);
}

export function isTrainingWorkerAuthenticated(request: Request): boolean {
  return hasBearerToken(request, process.env.VITROFLOW_TRAINING_WORKER_TOKEN);
}

/** A developer credential for pulling review state; distinct from worker tokens. */
export function isExportAuthenticated(request: Request): boolean {
  return hasBearerToken(request, process.env.VITROFLOW_EXPORT_TOKEN);
}
