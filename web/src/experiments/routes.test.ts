import { expect, test } from "bun:test";
import { isNotFound } from "@tanstack/react-router";

import { Route as DishRoute } from "../routes/_workbench/experiments.$experiment.$dish";
import { Route as ExperimentRoute } from "../routes/_workbench/experiments.$experiment.index";

const EXPERIMENT_ID = "11111111-1111-4111-8111-111111111111";

type RouteLoader = (context: {
  params: Record<string, string>;
  deps: Record<string, unknown>;
}) => unknown | Promise<unknown>;

async function expectNotFound(
  loader: RouteLoader,
  params: Record<string, string>,
  deps: Record<string, unknown> = {},
) {
  try {
    await loader({ params, deps });
    throw new Error("Expected route loader to throw notFound");
  } catch (cause) {
    expect(isNotFound(cause)).toBeTrue();
  }
}

test("experiment routes reject malformed resource identities as not found", async () => {
  await expectNotFound(ExperimentRoute.options.loader as RouteLoader, {
    experiment: "not-a-uuid",
  });
  await expectNotFound(DishRoute.options.loader as RouteLoader, {
    experiment: "not-a-uuid",
    dish: "A1",
  });
  await expectNotFound(
    DishRoute.options.loader as RouteLoader,
    { experiment: EXPERIMENT_ID, dish: "A1" },
    { round: "not-a-uuid" },
  );
  await expectNotFound(DishRoute.options.loader as RouteLoader, {
    experiment: EXPERIMENT_ID,
    dish: "A".repeat(256),
  });
});
