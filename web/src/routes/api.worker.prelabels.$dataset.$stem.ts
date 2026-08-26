import { createFileRoute } from "@tanstack/react-router";

import { imageRefSchema } from "../datasets/schema";
import {
  PrelabelFrozenError,
  PrelabelVersionMismatchError,
  writePrelabel,
} from "../server/prelabels";

export const Route = createFileRoute("/api/worker/prelabels/$dataset/$stem")({
  server: {
    handlers: {
      PUT: async ({ params, request }) => {
        try {
          writePrelabel(imageRefSchema.parse(params), await request.json());
          return Response.json({});
        } catch (error) {
          if (
            error instanceof PrelabelFrozenError ||
            error instanceof PrelabelVersionMismatchError
          ) {
            return new Response(error.message, { status: 409 });
          }
          return new Response(
            error instanceof Error ? error.message : String(error),
            { status: 400 },
          );
        }
      },
    },
  },
});
