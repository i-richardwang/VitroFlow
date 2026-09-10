import { resolve } from "node:path";

import { checkArchitecture } from "./architecture";

const root = resolve(import.meta.dir, "..");
const paths = [
  ...new Bun.Glob("src/**/*.{ts,tsx}").scanSync({ cwd: root }),
].filter(
  (file) =>
    !file.startsWith("src/paraglide/") && file !== "src/routeTree.gen.ts",
);
paths.push("scripts/maintenance.ts", "scripts/collect-blobs.ts");
const sources = new Map(
  await Promise.all(
    paths
      .sort()
      .map(
        async (file) =>
          [file, await Bun.file(resolve(root, file)).text()] as const,
      ),
  ),
);
const errors = checkArchitecture(sources);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    "Web architecture: layer boundaries, pure capabilities, server APIs and dependency cycles checked",
  );
}
