import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z, type ZodType } from "zod";

import { annotationSchema } from "../src/annotation/schema";
import { datasetManifestSchema } from "../src/datasets/manifest";
import { inferenceOutcomeSchema } from "../src/detection/schema";
import { inferenceAssignmentSchema } from "../src/inference/assignments";
import {
  datasetSnapshotSchema,
  trainingRunSchema,
} from "../src/training/schema";

const OUTPUT = path.resolve(import.meta.dir, "../../src/vitroflow/contracts");
const CHECK = process.argv.includes("--check");
const contracts: ReadonlyArray<[string, ZodType]> = [
  ["annotation", annotationSchema],
  ["dataset-manifest", datasetManifestSchema],
  ["inference-assignment", inferenceAssignmentSchema],
  ["inference-outcome", inferenceOutcomeSchema],
  ["training-run", trainingRunSchema],
  ["training-snapshot", datasetSnapshotSchema],
];

await mkdir(OUTPUT, { recursive: true });
let stale = false;
for (const [name, schema] of contracts) {
  const target = path.join(OUTPUT, `${name}.schema.json`);
  const document = {
    $id: `https://vitroflow.local/contracts/${name}.schema.json`,
    ...z.toJSONSchema(schema, { io: "input" }),
  };
  const expected = `${JSON.stringify(document, null, 2)}\n`;
  if (!CHECK) {
    await writeFile(target, expected);
    continue;
  }
  const actual = await readFile(target, "utf8").catch(() => "");
  if (actual !== expected) {
    console.error(`${path.relative(process.cwd(), target)} is stale`);
    stale = true;
  }
}
if (stale) process.exitCode = 1;
