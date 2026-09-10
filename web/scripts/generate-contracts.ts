import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z, type ZodType } from "zod";

import { trainingParametersSchema } from "../src/domain/training/parameters";
import { annotationSchema } from "../src/domain/annotation/schema";
import { datasetManifestSchema } from "../src/domain/datasets/manifest";
import { inferenceOutcomeSchema } from "../src/domain/detection/schema";
import { inferenceAssignmentSchema } from "../src/domain/inference/assignments";
import {
  datasetSnapshotSchema,
  trainingRunSchema,
} from "../src/domain/training/schema";

const OUTPUT = path.resolve(import.meta.dir, "../../src/vitroflow/contracts");
const CHECK = process.argv.includes("--check");
const contracts: ReadonlyArray<[string, ZodType]> = [
  ["annotation", annotationSchema],
  ["training-parameters", trainingParametersSchema],
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
