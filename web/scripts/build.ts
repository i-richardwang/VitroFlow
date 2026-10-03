import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const vite = Bun.spawn(["bun", "x", "vite", "build"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
if (await vite.exited) process.exit(1);
const result = await Bun.build({
  entrypoints: [
    "server.ts",
    "scripts/collect-blobs.ts",
    "scripts/maintenance.ts",
    "scripts/analyze-images.ts",
    "src/server/images/dish-thread.ts",
  ].map((file) => resolve(root, file)),
  outdir: resolve(root, "dist"),
  naming: "[name].[ext]",
  target: "bun",
  packages: "external",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
