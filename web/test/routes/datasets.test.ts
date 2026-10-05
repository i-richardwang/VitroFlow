import { expect, test } from "bun:test";
import { isNotFound } from "@tanstack/react-router";
import type { z } from "zod";

import { Route as DatasetImageRoute } from "../../src/routes/_workbench/datasets.$dataset.$digest";

type Loader = (context: {
  params: Record<string, string>;
  deps: Record<string, unknown>;
}) => unknown | Promise<unknown>;

test("an image link names which reading to show", () => {
  const search = DatasetImageRoute.options.validateSearch as z.ZodType<{
    show?: "review" | "detection";
  }>;
  expect(search.parse({ show: "detection" })).toEqual({ show: "detection" });
  expect(search.parse({ show: "original" })).toEqual({ show: undefined });
  expect(search.parse({})).toEqual({ show: undefined });
});

test("the dataset image page rejects a malformed digest as not found", async () => {
  try {
    await (DatasetImageRoute.options.loader as Loader)({
      params: { dataset: "seed-set", digest: "not-a-digest" },
      deps: {},
    });
    throw new Error("Expected route loader to throw notFound");
  } catch (cause) {
    expect(isNotFound(cause)).toBeTrue();
  }
});
