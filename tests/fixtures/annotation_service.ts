import { issueTaskToken } from "../../web/src/server/transport/mcp/task-credentials";
import "../../web/test/setup";
import { serveAnnotationMcp } from "../../web/src/server/transport/mcp/annotation";
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
  annotationRuntime: runtime,
};
await recordWorkerHeartbeat(owner);
const run = await createAnnotationRun(
  {
    ref: { digest: observed.digests[0]!, modelId: observed.version.modelId },
    input: null,
    scope: null,
  },
  "worker",
  user.id,
);
await claimAnnotationRun(owner);
const binding = await assignWorkerTask(
  run.id,
  owner,
  `${run.id}/tile-000-000`,
  crypto.randomUUID(),
);
if (binding.accepted) throw new Error("Unexpected acceptance");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: serveAnnotationMcp,
});
console.log(
  JSON.stringify({
    endpoint: `http://127.0.0.1:${server.port}/api/annotation/mcp`,
    token: issueTaskToken(binding.principal),
    taskId: binding.taskId,
  }),
);
