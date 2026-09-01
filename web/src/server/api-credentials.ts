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

interface ApiRealm {
  matches: (pathname: string) => boolean;
  token: () => string | undefined;
}

/**
 * Each token-guarded API realm and the credential that opens it. A realm whose
 * credential is unconfigured is closed: every request to it answers 401.
 */
const API_REALMS: ApiRealm[] = [
  {
    matches: (pathname) => pathname.startsWith("/api/inference/"),
    token: () => process.env.VITROFLOW_INFERENCE_WORKER_TOKEN,
  },
  {
    matches: (pathname) => pathname.startsWith("/api/training/"),
    token: () => process.env.VITROFLOW_TRAINING_WORKER_TOKEN,
  },
  {
    matches: (pathname) =>
      pathname.startsWith("/api/agent/") || pathname === "/api/mcp",
    token: () => process.env.VITROFLOW_AGENT_TOKEN,
  },
  {
    matches: (pathname) => pathname.startsWith("/api/export/"),
    token: () => process.env.VITROFLOW_EXPORT_TOKEN,
  },
];

/**
 * Whether a token realm admits the request: true or false when the pathname
 * belongs to one, or null for paths the browser session realm owns.
 */
export function apiRequestAuthorization(
  pathname: string,
  request: Request,
): boolean | null {
  const realm = API_REALMS.find((realm) => realm.matches(pathname));
  return realm ? hasBearerToken(request, realm.token()) : null;
}
