import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  saveTrainingCheckpoint,
  readTrainingCheckpoint,
} from "../server/training/public";
import {
  parseTrainingQuery,
  parseWorkerValue,
  workerErrorResponse,
} from "../server/transport/http/worker";
import { MAX_TRAINING_CHECKPOINT_BYTES } from "../domain/training/artifact";

export const Route = createFileRoute(
  "/api/worker/training/runs/$runId/checkpoint",
)({
  server: {
    handlers: {
      GET: async ({ params, request, context }) => {
        try {
          const bytes = await readTrainingCheckpoint(
            params.runId,
            parseTrainingQuery(request, context.workerId),
          );
          return bytes
            ? new Response(Buffer.from(bytes), {
                headers: { "Content-Type": "application/zip" },
              })
            : new Response(null, { status: 404 });
        } catch (error) {
          return workerErrorResponse(
            error,
            "Training checkpoint download failed",
          );
        }
      },
      PUT: async ({ params, request, context }) => {
        try {
          const owner = parseTrainingQuery(request, context.workerId);
          const epoch = parseWorkerValue(
            Number(new URL(request.url).searchParams.get("epoch")),
            z.number().int().positive(),
            "epoch",
          );
          const length = Number(request.headers.get("content-length"));
          if (!Number.isSafeInteger(length) || length <= 0)
            return new Response("Content-Length is required", { status: 411 });
          if (length > MAX_TRAINING_CHECKPOINT_BYTES)
            return new Response("Checkpoint is too large", { status: 413 });
          const bytes = new Uint8Array(await request.arrayBuffer());
          if (bytes.length > MAX_TRAINING_CHECKPOINT_BYTES)
            return new Response("Checkpoint is too large", { status: 413 });
          return Response.json(
            await saveTrainingCheckpoint(params.runId, owner, epoch, bytes),
          );
        } catch (error) {
          return workerErrorResponse(
            error,
            "Training checkpoint upload failed",
          );
        }
      },
    },
  },
});
