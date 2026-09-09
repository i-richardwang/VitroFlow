import { createFileRoute } from "@tanstack/react-router";

import { imageResponse } from "../server/transport/http/image-files";
import { handleCanonicalImageUpload } from "../server/transport/http/image-upload";

export const Route = createFileRoute("/api/transfer/images/$digest")({
  server: {
    handlers: {
      GET: ({ params }) => imageResponse(params.digest),
      PUT: ({ params, request }) =>
        handleCanonicalImageUpload(params.digest, request),
    },
  },
});
