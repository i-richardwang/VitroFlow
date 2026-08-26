import { createFileRoute } from "@tanstack/react-router";

import { imageRefSchema } from "../datasets/schema";
import { readImageFile } from "../server/datasets";

export const Route = createFileRoute("/api/worker/images/$dataset/$stem")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const ref = imageRefSchema.safeParse(params);
        const image = ref.success ? readImageFile(ref.data) : null;
        if (!image) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(image.body, {
          headers: { "Content-Type": image.contentType },
        });
      },
    },
  },
});
