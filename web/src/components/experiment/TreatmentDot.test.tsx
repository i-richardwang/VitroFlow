import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TreatmentDot } from "./TreatmentDot";

test("treatment colors extend beyond the curated series", () => {
  expect(renderToStaticMarkup(<TreatmentDot position={24} />)).toContain(
    "hsl(",
  );
});
