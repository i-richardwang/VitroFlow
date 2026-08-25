import { afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vitroflow-test-"));
process.env.VITROFLOW_DATA_ROOT = dataRoot;

afterAll(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
