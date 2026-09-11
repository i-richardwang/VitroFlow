import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { m } from "../paraglide/messages";
import { QualityAlert, QualityChips } from "./DetectionQuality";

test("unrecognized warnings render as labels rather than inherited object properties", () => {
  for (const Component of [QualityAlert, QualityChips]) {
    const markup = renderToStaticMarkup(
      createElement(Component, {
        quality: {
          status: "review_required",
          warnings: ["constructor", "new_warning"],
        },
      }),
    );
    expect(markup).toContain("constructor");
    expect(markup).toContain("new warning");
  }
});

test("known quality warnings use their localized labels", () => {
  const markup = renderToStaticMarkup(
    createElement(QualityAlert, {
      quality: { status: "review_required", warnings: ["low_focus"] },
    }),
  );
  expect(markup).toContain(m.quality_low_focus());
});
