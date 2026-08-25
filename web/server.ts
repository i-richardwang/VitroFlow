import handler from "./dist/server/server.js";

const CLIENT_DIR = `${import.meta.dir}/dist/client`;
const MAX_REQUEST_BYTES = 520 * 1024 * 1024;
const port = Number(process.env.PORT ?? 3000);

Bun.serve({
  port,
  maxRequestBodySize: MAX_REQUEST_BYTES,
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
