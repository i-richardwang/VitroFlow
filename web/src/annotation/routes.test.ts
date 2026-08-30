import { expect, test } from "bun:test";
import { isNotFound } from "@tanstack/react-router";

import { Route as ReviewRoute } from "../routes/_workbench/review.$model.$digest";

type ReviewLoader = (context: {
  params: Record<string, string>;
  deps: { version?: unknown };
}) => unknown | Promise<unknown>;

test("review routes reject malformed resource identities as not found", async () => {
  try {
    await (ReviewRoute.options.loader as ReviewLoader)({
      params: { model: "seed-detector", digest: "a".repeat(64) },
      deps: { version: "!" },
    });
    throw new Error("Expected route loader to throw notFound");
  } catch (cause) {
    expect(isNotFound(cause)).toBeTrue();
  }
});
