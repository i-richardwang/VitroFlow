import { secretsEqual } from "./secrets";

export function isWorkerAuthenticated(request: Request): boolean {
  const expected = process.env.VITROFLOW_WORKER_TOKEN;
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
