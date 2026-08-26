import { createHmac } from "node:crypto";

import { redirect as routerRedirect } from "@tanstack/react-router";
import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";

import { secretsEqual } from "./secrets";

const COOKIE = "vitroflow_session";
const SESSION_DAYS = 30;

function password(): string | undefined {
  return process.env.VITROFLOW_PASSWORD || undefined;
}

function sessionToken(secret: string): string {
  return createHmac("sha256", secret).update("session").digest("hex");
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
  return token !== undefined && secretsEqual(token, sessionToken(secret));
}

export function signIn(candidate: string): boolean {
  const secret = password();
  if (secret === undefined || !secretsEqual(candidate, secret)) {
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

export function redirect(to: string): Response {
  return routerRedirect({ href: to, statusCode: 303 });
}

export function hasSession(): boolean {
  return password() !== undefined && getCookie(COOKIE) !== undefined;
}
