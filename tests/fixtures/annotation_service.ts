import { issueTaskToken } from "../../web/src/server/transport/mcp/task-credentials";
/** Real product MCP endpoint for the Python bridge integration test. */
import "../../web/test/setup";
import { serveMcp } from "../../web/src/server/transport/mcp/agent";
import {
  observeImages,
  signInAs,
  testHeartbeat,
} from "../../web/src/server/testing/fixtures";
import { recordWorkerHeartbeat } from "../../web/src/server/workers/public";
import {
  createAnnotationRun,
  claimAnnotationRun,
  assignWorkerTask,
} from "../../web/src/server/annotation-runs/public";

const { user } = await signInAs("member");
const observed = await observeImages("python-mcp", ["python-mcp"]);
const runtime = {
  runtime: "pi" as const,
  version: "test",
  model: "test/vision",
};
const owner = {
  ...testHeartbeat("python-mcp-worker"),
  annotationRuntimes: [runtime],
};
await recordWorkerHeartbeat(owner);
const run = await createAnnotationRun(
  {
    id: crypto.randomUUID(),
    ref: { digest: observed.digests[0]!, modelId: observed.version.modelId },
    executor: {kind: "worker", runtime: "pi"},
    input: null,
  },
  user.id,
);
await claimAnnotationRun(owner);
const binding = await assignWorkerTask(
  run.id,
  owner,
  `${run.id}/tile-000-000`,
  crypto.randomUUID(),
  runtime,
);
if (binding.accepted) throw new Error("Unexpected acceptance");
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: serveMcp });
console.log(
  JSON.stringify({
    endpoint: `http://127.0.0.1:${server.port}/api/mcp`,
    token: issueTaskToken(binding.principal),
    taskId: binding.taskId,
  }),
);
