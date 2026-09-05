import { AsyncLocalStorage } from "node:async_hooks";

import { getCookie, setCookie } from "@tanstack/react-start/server";

import {
  cookieMaxAge,
  cookieName,
  extractLocaleFromRequest,
  overwriteServerAsyncLocalStorage,
  type Locale,
} from "../paraglide/runtime";

type LocaleScope = {
  locale?: Locale;
  origin?: string;
  messageCalls?: Set<string>;
};

/**
 * Paraglide reads the request's locale from async local storage while the
 * server renders, so every message function resolves against the request
 * that called it. The runtime expects the storage to be installed once.
 */
const localeScope = new AsyncLocalStorage<LocaleScope>();
overwriteServerAsyncLocalStorage(localeScope);

/**
 * Runs the request handler with its locale resolved (cookie, then
 * Accept-Language, then the base locale) and pins that locale in a cookie on
 * the first visit, so the client hydrates with the locale the server rendered.
 */
export function withRequestLocale<T>(request: Request, handle: () => T): T {
  const locale = extractLocaleFromRequest(request);
  if (getCookie(cookieName) !== locale) {
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
