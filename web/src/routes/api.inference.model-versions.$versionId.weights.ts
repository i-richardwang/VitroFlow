import * as fs from "node:fs";

import { createFileRoute } from "@tanstack/react-router";

import { readModelVersion } from "../server/model-registry";
import { DATA_ROOT, resolveWithin } from "../server/paths";

export const Route = createFileRoute(
  "/api/inference/model-versions/$versionId/weights",
)({
  server: {
    handlers: {
      GET: ({ params }) => {
        try {
          const version = readModelVersion(params.versionId);
          if (!version) return new Response("Model version not found", { status: 404 });
          if (version.artifact.kind !== "ultralytics") {
            return new Response("Model version has no downloadable weights", {
              status: 409,
            });
          }
          const filePath = resolveWithin(DATA_ROOT, version.artifact.path);
          const weights = fs.readFileSync(filePath);
          if (weights.byteLength !== version.artifact.bytes) {
            throw new Error("Published model artifact size does not match its record");
          }
          return new Response(weights, {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(weights.byteLength),
            },
          });
        } catch (error) {
          return new Response(error instanceof Error ? error.message : String(error), {
            status: 500,
          });
        }
      },
    },
  },
});
