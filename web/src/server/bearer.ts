/** The credential a request presents in an RFC 6750 Authorization header. */
export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return null;
  const token = authorization.slice(prefix.length).trim();
  return token.length > 0 ? token : null;
}
