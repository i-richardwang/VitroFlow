import type { ApiScope } from "../auth/integrations";
import { authorizeApiKey } from "./api-keys";
import { bearerToken } from "./bearer";
import { secretsEqual } from "./secrets";

interface ApiRealm {
  matches: (pathname: string) => boolean;
  /** Whether the request may enter; null hands it to the browser session. */
  admits: (request: Request) => Promise<boolean | null>;
}

/**
 * A realm workers open with the role credential configured for them. An
 * unconfigured credential closes the realm: every request answers 401.
 */
function workerRealm(prefix: string, credential: string): ApiRealm {
  return {
    matches: (pathname) => pathname.startsWith(prefix),
    admits: async (request) => {
      const expected = process.env[credential];
      const presented = bearerToken(request);
      return (
        expected !== undefined &&
        presented !== null &&
        secretsEqual(presented, expected)
      );
    },
  };
}

/**
 * A realm an account opens with a personal API key issued for `scope`. A
 * request that presents no key is the browser's, and the session decides.
 */
function apiKeyRealm(prefix: string, scope: ApiScope): ApiRealm {
  return {
    matches: (pathname) => pathname.startsWith(prefix),
    admits: async (request) =>
      bearerToken(request) === null
        ? null
        : (await authorizeApiKey(request, scope)) !== null,
  };
}

/** Each bearer-guarded API realm and what opens it. */
const API_REALMS: ApiRealm[] = [
  workerRealm("/api/inference/", "VITROFLOW_INFERENCE_WORKER_TOKEN"),
  workerRealm("/api/training/", "VITROFLOW_TRAINING_WORKER_TOKEN"),
  apiKeyRealm("/api/transfer/", "transfer"),
];

/**
 * Whether a bearer realm admits the request: true or false when the pathname
 * belongs to one and the request presents a credential for it, or null when
 * the browser session decides.
 */
export async function apiRequestAuthorization(
  pathname: string,
  request: Request,
): Promise<boolean | null> {
  const realm = API_REALMS.find((realm) => realm.matches(pathname));
  return realm ? realm.admits(request) : null;
}
