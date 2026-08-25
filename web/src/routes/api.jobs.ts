import { createFileRoute } from "@tanstack/react-router";

import { createJobFromUpload } from "../server/job-upload";

function redirect(request: Request, search: URLSearchParams): Response {
  const url = new URL("/jobs", request.url);
  url.search = search.toString();
  return Response.redirect(url, 303);
}

export const Route = createFileRoute("/api/jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const job = await createJobFromUpload(await request.formData());
          return redirect(request, new URLSearchParams({ created: job.id }));
        } catch (error) {
          return redirect(
            request,
            new URLSearchParams({
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      },
    },
  },
});
