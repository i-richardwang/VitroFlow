import { expect, test } from "bun:test";

import { YOLO26_SEED_SMALL_RECIPE } from "./recipes";
import {
  PARAMETER_FIELDS,
  trainingOverrides,
  trainingOverridesSchema,
  trainingParametersSchema,
} from "./parameters";

test("the Web boundary projects a full recipe into explicit overrides", () => {
  const parameters = trainingParametersSchema.parse(
    YOLO26_SEED_SMALL_RECIPE.parameters,
  );
  const overrides = trainingOverrides(parameters);

  expect(Object.keys(overrides).sort()).toEqual(
    ["batch", "epochs", "imgsz", "lr0", "patience"].sort(),
  );
  expect(trainingOverridesSchema.parse(overrides)).toEqual(overrides);
  expect(() => trainingOverridesSchema.parse(parameters)).toThrow(
    /unrecognized/i,
  );
  for (const field of PARAMETER_FIELDS) {
    const value = overrides[field.key];
    expect(value).toBeGreaterThanOrEqual(field.min);
    expect(value).toBeLessThanOrEqual(field.max);
    const steps = (value - field.min) / field.step;
    expect(steps).toBeCloseTo(Math.round(steps));
  }
});
