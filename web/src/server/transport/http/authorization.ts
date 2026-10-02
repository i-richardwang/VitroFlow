import type { ApiScope } from "../../../domain/auth/integrations";
import { authorizeApiKey, bearerToken } from "../../auth/public";
import { authenticateWorker } from "../../workers/public";

interface ApiRealm {
  matches: (pathname: string) => boolean;
  /** Whether the request may enter; null hands it to the browser session. */
  admits: (request: Request) => Promise<boolean | null>;
}

/** The realm enrolled workers open with the token they were issued. */
function workerRealm(prefix: string): ApiRealm {
  return {
    matches: (pathname) => pathname.startsWith(prefix),
    admits: async (request) => {
      const token = bearerToken(request);
      return token !== null && (await authenticateWorker(token)) !== null;
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
      bearerToken(request) === null ? null : authorizeApiKey(request, scope),
  };
}

/** Each bearer-guarded API realm and what opens it. */
const API_REALMS: ApiRealm[] = [
  workerRealm("/api/worker/"),
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
