import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { modelName, className } from "./model-names";
import { m } from "../paraglide/messages";

test("user identifiers remain names even when Object has a property by that name", () => {
  for (const id of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
    expect(modelName({ id, name: "My model" })).toBe("My model");
    expect(className(id)).toBe(id);
    expect(renderToString(createElement("span", null, className(id)))).toBe(
      `<span>${id}</span>`,
    );
  }
});

test("builtin names use the current language", () => {
  expect(modelName({ id: "seed-detector", name: "Stored name" })).toBe(
    m.builtin_model_seed_detector(),
  );
  expect(className("seed")).toBe(m.builtin_class_seed());
});
