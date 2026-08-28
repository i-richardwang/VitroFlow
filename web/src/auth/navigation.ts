const DEFAULT_RETURN_PATH = "/";
const AUTH_PATHS = new Set(["/login", "/logout"]);

/** A browser destination that stays inside the workbench and outside auth. */
export function returnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return DEFAULT_RETURN_PATH;
  }
  const destination = new URL(value, "http://vitroflow.local");
  if (AUTH_PATHS.has(destination.pathname)) return DEFAULT_RETURN_PATH;
  return `${destination.pathname}${destination.search}`;
}

/** The sign-in page for a protected destination. */
export function loginPath(destination: unknown, rejected = false): string {
  const search = new URLSearchParams();
  const target = returnPath(destination);
  if (target !== DEFAULT_RETURN_PATH) search.set("returnTo", target);
  if (rejected) search.set("rejected", "true");
  const query = search.toString();
  return query ? `/login?${query}` : "/login";
}

/** The path and query a document request was trying to reach. */
export function requestedPath(request: Request): string {
  const { pathname, search } = new URL(request.url);
  return returnPath(`${pathname}${search}`);
}
