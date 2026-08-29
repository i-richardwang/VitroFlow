process.env.DATABASE_URL = "pglite://";
process.env.VITROFLOW_BLOB_ENDPOINT = "memory://";
for (const credential of [
  "VITROFLOW_PASSWORD",
  "VITROFLOW_INFERENCE_WORKER_TOKEN",
  "VITROFLOW_TRAINING_WORKER_TOKEN",
  "VITROFLOW_EXPORT_TOKEN",
]) {
  delete process.env[credential];
}
