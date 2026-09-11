import { expect, test } from "bun:test";

import { m } from "../paraglide/messages";
import { errorMessage } from "./errors";

test("unrecognized business codes use their category, including Object property names", () => {
  for (const code of ["constructor", "toString", "__proto__", "new_code"]) {
    expect(
      errorMessage({
        kind: "business_failure",
        code,
        category: "conflict",
        details: {},
      }),
    ).toBe(m.error_conflict());
  }
});

test("known refusals have their specific message", () => {
  expect(
    errorMessage({
      kind: "business_failure",
      code: "model_id_taken",
      category: "conflict",
      details: {},
    }),
  ).toBe(m.error_model_id_taken());
});
