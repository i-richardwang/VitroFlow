import { expect, test } from "bun:test";
import { isNotFound } from "@tanstack/react-router";
import type { z } from "zod";

import { Route as ObservationUnitRoute } from "../routes/_workbench/experiments.$experiment.$observationUnit";
import { Route as ExperimentRoute } from "../routes/_workbench/experiments.$experiment.index";

const EXPERIMENT_ID = "11111111-1111-4111-8111-111111111111";
const OBSERVATION_UNIT_ID = "22222222-2222-4222-8222-222222222222";

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
  await expectNotFound(ObservationUnitRoute.options.loader as RouteLoader, {
    experiment: "not-a-uuid",
    observationUnit: OBSERVATION_UNIT_ID,
  });
  await expectNotFound(ObservationUnitRoute.options.loader as RouteLoader, {
    experiment: EXPERIMENT_ID,
    observationUnit: "A1",
  });
});

test("an observation the link cannot name falls back to the newest", () => {
  const search = ObservationUnitRoute.options.validateSearch as z.ZodType<{
    observation?: string;
    edit?: true;
  }>;
  expect(search.parse({ observation: "not-a-uuid" })).toEqual({
    observation: undefined,
    edit: undefined,
  });
  expect(
    search.parse({ observation: OBSERVATION_UNIT_ID, edit: true }),
  ).toEqual({ observation: OBSERVATION_UNIT_ID, edit: true });
});
