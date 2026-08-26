import { createFileRoute } from "@tanstack/react-router";

import { addImages } from "../server/upload";

export const Route = createFileRoute("/api/datasets/$dataset/images")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const form = await request.formData();
          const files = form
            .getAll("images")
            .filter(
              (value): value is File => value instanceof File && value.size > 0,
            );
          const added = await addImages(params.dataset, files);
          return Response.json({ added: added.map((image) => image.stem) });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 400 },
          );
        }
      },
    },
  },
});
