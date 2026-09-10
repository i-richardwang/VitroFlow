import { expect, test } from "bun:test";

import { loginPath, requestedPath, returnPath } from "./navigation";

test("login navigation preserves only internal workbench destinations", () => {
  const request = new Request(
    "http://example.invalid/datasets/seeds?state=complete",
  );
  expect(requestedPath(request)).toBe("/datasets/seeds?state=complete");
  expect(loginPath(requestedPath(request))).toBe(
    "/login?returnTo=%2Fdatasets%2Fseeds%3Fstate%3Dcomplete",
  );
  expect(loginPath("/")).toBe("/login");
  for (const unsafe of [
    "https://example.invalid",
    "//example.invalid",
    "/\\example.invalid",
    "/login",
  ]) {
    expect(returnPath(unsafe)).toBe("/");
  }
});
