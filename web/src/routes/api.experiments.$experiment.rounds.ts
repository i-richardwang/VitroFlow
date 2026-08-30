import { createFileRoute } from "@tanstack/react-router";
import { ZodError } from "zod";

import {
  addRound,
  ExperimentNotFoundError,
  ExperimentPhotoAlreadyUsedError,
  ImagesNotStoredError,
  RoundRejectedError,
} from "../server/experiments";

function failed(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Adds one round of stored photographs to an experiment. The round is one
 * occasion: the experiment gains all of its photos or none of them.
 */
export const Route = createFileRoute("/api/experiments/$experiment/rounds")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const body: unknown = await request.json();
          if (
            typeof body !== "object" ||
            body === null ||
            Array.isArray(body)
          ) {
            return failed("Request body must be a JSON object", 400);
          }
          return Response.json(
            await addRound({ ...body, experiment: params.experiment }),
          );
        } catch (error) {
          if (error instanceof SyntaxError) {
            return failed("Request body must be valid JSON", 400);
          }
          if (error instanceof ZodError) {
            return failed(error.issues[0]?.message ?? "Invalid round", 400);
          }
          if (error instanceof RoundRejectedError) {
            return failed(error.message, 422);
          }
          if (error instanceof ExperimentPhotoAlreadyUsedError) {
            return failed(error.message, 409);
          }
          if (error instanceof ExperimentNotFoundError) {
            return failed(error.message, 404);
          }
          if (error instanceof ImagesNotStoredError) {
            return failed(error.message, 409);
          }
          console.error(
            `Add round failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return failed("Could not add the round", 500);
        }
      },
    },
  },
});
