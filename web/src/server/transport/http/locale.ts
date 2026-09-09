import { AsyncLocalStorage } from "node:async_hooks";

import { getCookie, setCookie } from "@tanstack/react-start/server";

import {
  cookieMaxAge,
  cookieName,
  extractLocaleFromRequest,
  overwriteServerAsyncLocalStorage,
  type ParaglideAsyncLocalStorage,
} from "../../../paraglide/runtime";

type LocaleScope = Parameters<ParaglideAsyncLocalStorage["run"]>[0];

/**
 * Paraglide reads the request's locale from async local storage while the
 * server renders, so every message function resolves against the request
 * that called it. The runtime expects the storage to be installed once.
 */
const localeScope = new AsyncLocalStorage<LocaleScope>();
overwriteServerAsyncLocalStorage(localeScope);

/** A browser asking for a page, as opposed to an API client or a fetch. */
function requestsDocument(request: Request): boolean {
  return request.headers.get("accept")?.includes("text/html") ?? false;
}

/**
 * Runs the request handler with its locale resolved: the cookie, then
 * Accept-Language, then the base locale. A document request without the
 * cookie gets one, so the client hydrates with the locale the server
 * rendered and later visits stay in it until the reader chooses another.
 */
export function withRequestLocale<T>(request: Request, handle: () => T): T {
  const locale = extractLocaleFromRequest(request);
  if (requestsDocument(request) && getCookie(cookieName) !== locale) {
    setCookie(cookieName, locale, {
      path: "/",
      maxAge: cookieMaxAge,
      sameSite: "lax",
    });
  }
  return localeScope.run(
    { locale, origin: new URL(request.url).origin, messageCalls: new Set() },
    handle,
  );
}
