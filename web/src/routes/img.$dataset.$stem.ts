import { createFileRoute } from "@tanstack/react-router";

import { imageResponse } from "../server/image-files";

export const Route = createFileRoute("/img/$dataset/$stem")({
  server: {
    handlers: {
      GET: ({ params }) =>
        imageResponse(params, { "Cache-Control": "private, max-age=3600" }),
    },
  },
});
