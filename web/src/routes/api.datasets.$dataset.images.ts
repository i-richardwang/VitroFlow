import { createFileRoute } from "@tanstack/react-router";
import { ZodError } from "zod";

import { claimImages, ImagesNotStoredError } from "../server/datasets";

function failed(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Claims stored photographs for a dataset. One request is one intent: the
 * dataset gains the whole set or none of it.
 */
export const Route = createFileRoute("/api/datasets/$dataset/images")({
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
            await claimImages({ ...body, dataset: params.dataset }),
          );
        } catch (error) {
          if (error instanceof SyntaxError) {
            return failed("Request body must be valid JSON", 400);
          }
          if (error instanceof ZodError) {
            return failed(
              error.issues[0]?.message ?? "Invalid image claim",
              400,
            );
          }
          if (error instanceof ImagesNotStoredError) {
            return failed(error.message, 409);
          }
          console.error(
            `Claim images failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return failed("Could not claim images", 500);
        }
      },
    },
  },
});
