import { createHmac, timingSafeEqual } from "node:crypto";

import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";

const COOKIE = "vitroflow_session";
const SESSION_DAYS = 30;

function password(): string | undefined {
  return process.env.VITROFLOW_PASSWORD || undefined;
}

function sessionToken(secret: string): string {
  return createHmac("sha256", secret).update("session").digest("hex");
}

function equal(a: string, b: string): boolean {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}

export function isAuthenticated(request: Request): boolean {
  const secret = password();
  if (secret === undefined) {
    return true;
  }
  const cookies = request.headers.get("cookie") ?? "";
  const token = cookies
    .split(";")
    .map((pair) => pair.trim().split("="))
    .find(([name]) => name === COOKIE)?.[1];
  return token !== undefined && equal(token, sessionToken(secret));
}

export function signIn(candidate: string): boolean {
  const secret = password();
  if (secret === undefined || !equal(candidate, secret)) {
    return false;
  }
  setCookie(COOKIE, sessionToken(secret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return true;
}

export function signOut(): void {
  deleteCookie(COOKIE, { path: "/" });
}

export function hasSession(): boolean {
  return password() !== undefined && getCookie(COOKIE) !== undefined;
}
