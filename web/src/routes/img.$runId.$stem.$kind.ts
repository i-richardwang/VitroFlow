import { createFileRoute } from "@tanstack/react-router";

import { IMAGE_KINDS } from "../detection/schema";
import { readRunImage } from "../server/store";

export const Route = createFileRoute("/img/$runId/$stem/$kind")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const kind = IMAGE_KINDS.find((candidate) => candidate === params.kind);
        const image = kind && readRunImage(params.runId, params.stem, kind);
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
