import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TreatmentDot } from "./TreatmentDot";

const dot = (position: number) =>
  renderToStaticMarkup(<TreatmentDot position={position} />);

test("neighbouring treatments take different colors", () => {
  const firstEight = Array.from({ length: 8 }, (_, index) => dot(index + 1));
  expect(new Set(firstEight).size).toBe(8);
});

test("treatments past the palette repeat it from the start", () => {
  expect(dot(9)).toBe(dot(1));
  expect(dot(24)).toBe(dot(8));
});
