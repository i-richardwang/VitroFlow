import fs from "node:fs";
import path from "node:path";

import { expect, test } from "bun:test";

import { datasetExportSchema } from "./export";

const CONTRACT_FIXTURE = path.resolve(
  import.meta.dir,
  "../../../tests/fixtures/contracts/dataset-export.json",
);

function contractFixture(): unknown {
  return JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, "utf-8"));
}

test("shared dataset export contract", () => {
  const dataset = datasetExportSchema.parse(contractFixture());

  expect(dataset.dataset).toBe("seed-set");
  expect(dataset.images[0]?.annotation?.instances).toHaveLength(1);
});

test("export documents must describe their enclosing image", () => {
  const dataset = contractFixture() as {
    images: [{ annotation: { image: { digest: string } } }];
  };
  dataset.images[0].annotation.image.digest = "d".repeat(64);

  expect(datasetExportSchema.safeParse(dataset).success).toBe(false);
});
