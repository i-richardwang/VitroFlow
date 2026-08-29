import handler from "./dist/server/server.js";
import { MAX_TRAINING_ARTIFACT_REQUEST_BYTES } from "./src/training/artifact";

const CLIENT_DIR = `${import.meta.dir}/dist/client`;
const port = Number(process.env.PORT ?? 3000);

// Reach the database and the blob store before accepting traffic, so a bad
// DATABASE_URL or blob-store configuration fails the start rather than a request.
const health = await handler.fetch(new Request("http://localhost/healthz"));
if (!health.ok) {
  throw new Error(`Server is not ready: ${await health.text()}`);
}

Bun.serve({
  port,
  maxRequestBodySize: MAX_TRAINING_ARTIFACT_REQUEST_BYTES,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/assets/")) {
      const asset = Bun.file(`${CLIENT_DIR}${pathname}`);
      if (await asset.exists()) {
        return new Response(asset, {
          headers: { "Cache-Control": "public, max-age=31536000, immutable" },
        });
      }
    }
    return handler.fetch(request);
  },
});

console.log(`VitroFlow workbench listening on http://localhost:${port}`);
