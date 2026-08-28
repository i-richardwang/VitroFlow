import { expect, spyOn, test } from "bun:test";

import {
  TrainingArtifactValidationError,
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../training/errors";
import {
  TrainingRequestError,
  trainingWorkerErrorResponse,
} from "./training-worker-http";

test("training worker HTTP errors preserve protocol semantics", () => {
  expect(
    trainingWorkerErrorResponse(
      new TrainingRequestError("invalid request"),
      "Operation failed",
    ).status,
  ).toBe(400);
  expect(
    trainingWorkerErrorResponse(
      new TrainingRunNotFoundError("unknown run"),
      "Operation failed",
    ).status,
  ).toBe(404);
  expect(
    trainingWorkerErrorResponse(
      new TrainingRunConflictError("lease lost"),
      "Operation failed",
    ).status,
  ).toBe(409);
  expect(
    trainingWorkerErrorResponse(
      new TrainingArtifactValidationError("invalid artifact"),
      "Operation failed",
    ).status,
  ).toBe(422);
});

test("training worker HTTP errors hide unexpected server failures", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const response = trainingWorkerErrorResponse(
      new Error("database connection string"),
      "Training operation failed",
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Training operation failed");
    expect(logged).toHaveBeenCalledTimes(1);
  } finally {
    logged.mockRestore();
  }
});
