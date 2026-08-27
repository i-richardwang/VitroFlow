import { afterEach, describe, expect, test } from "bun:test";

import {
  isInferenceWorkerAuthenticated,
  isTrainingWorkerAuthenticated,
} from "./worker-auth";

const originalInference = process.env.VITROFLOW_INFERENCE_WORKER_TOKEN;
const originalTraining = process.env.VITROFLOW_TRAINING_WORKER_TOKEN;

afterEach(() => {
  if (originalInference === undefined) {
    delete process.env.VITROFLOW_INFERENCE_WORKER_TOKEN;
  } else {
    process.env.VITROFLOW_INFERENCE_WORKER_TOKEN = originalInference;
  }
  if (originalTraining === undefined) {
    delete process.env.VITROFLOW_TRAINING_WORKER_TOKEN;
  } else {
    process.env.VITROFLOW_TRAINING_WORKER_TOKEN = originalTraining;
  }
});

describe("worker authentication", () => {
  test("uses distinct credentials for inference and training", () => {
    process.env.VITROFLOW_INFERENCE_WORKER_TOKEN = "inference-secret";
    process.env.VITROFLOW_TRAINING_WORKER_TOKEN = "training-secret";
    const request = (token: string) =>
      new Request("http://localhost", {
        headers: { Authorization: `Bearer ${token}` },
      });

    expect(isInferenceWorkerAuthenticated(request("inference-secret"))).toBe(true);
    expect(isInferenceWorkerAuthenticated(request("training-secret"))).toBe(false);
    expect(isTrainingWorkerAuthenticated(request("training-secret"))).toBe(true);
    expect(isTrainingWorkerAuthenticated(request("inference-secret"))).toBe(false);
  });

  test("rejects requests when its credential is not configured", () => {
    delete process.env.VITROFLOW_INFERENCE_WORKER_TOKEN;
    delete process.env.VITROFLOW_TRAINING_WORKER_TOKEN;
    expect(isInferenceWorkerAuthenticated(new Request("http://localhost"))).toBe(false);
    expect(isTrainingWorkerAuthenticated(new Request("http://localhost"))).toBe(false);
  });
});
