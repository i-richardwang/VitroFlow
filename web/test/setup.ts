import { afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vitroflow-test-"));
process.env.VITROFLOW_DATA_ROOT = dataRoot;
process.env.DATABASE_URL = "pglite://";
for (const credential of [
  "VITROFLOW_PASSWORD",
  "VITROFLOW_INFERENCE_WORKER_TOKEN",
  "VITROFLOW_TRAINING_WORKER_TOKEN",
  "VITROFLOW_EXPORT_TOKEN",
]) {
  delete process.env[credential];
}

afterAll(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
