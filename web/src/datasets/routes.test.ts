import { expect, test } from "bun:test";
import { isNotFound } from "@tanstack/react-router";
import type { z } from "zod";

import { Route as DatasetImageRoute } from "../routes/_workbench/datasets.$dataset.$digest";

type Loader = (context: {
  params: Record<string, string>;
  deps: Record<string, unknown>;
}) => unknown | Promise<unknown>;

test("an image link names the boxes to show and whether to edit", () => {
  const search = DatasetImageRoute.options.validateSearch as z.ZodType<{
    show?: "review" | "detection";
    edit?: true;
  }>;
  expect(search.parse({ show: "detection", edit: true })).toEqual({
    show: "detection",
    edit: true,
  });
  expect(search.parse({ show: "draft", edit: "yes" })).toEqual({
    show: undefined,
    edit: undefined,
  });
  expect(search.parse({})).toEqual({ show: undefined, edit: undefined });
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
