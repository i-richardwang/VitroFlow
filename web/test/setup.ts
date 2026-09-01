process.env.DATABASE_URL =
  process.env.VITROFLOW_TEST_DATABASE_URL ?? "pglite://";
process.env.VITROFLOW_BLOB_ENDPOINT = "memory://";
for (const credential of [
  "VITROFLOW_PASSWORD",
  "VITROFLOW_INFERENCE_WORKER_TOKEN",
  "VITROFLOW_TRAINING_WORKER_TOKEN",
  "VITROFLOW_EXPORT_TOKEN",
  "VITROFLOW_AGENT_TOKEN",
  "VITROFLOW_MCP_ALLOWED_HOSTNAMES",
]) {
  delete process.env[credential];
}
