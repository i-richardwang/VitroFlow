import { createFileRoute } from "@tanstack/react-router";

import { imageResponse } from "../server/image-files";
import { handleCanonicalImageUpload } from "../server/image-upload";

export const Route = createFileRoute("/api/transfer/images/$digest")({
  server: {
    handlers: {
      GET: ({ params }) => imageResponse(params.digest),
      PUT: ({ params, request }) =>
        handleCanonicalImageUpload(params.digest, request),
    },
  },
});
