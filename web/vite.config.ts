import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { paraglideOptions } from "./paraglide.config";

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    paraglideVitePlugin(paraglideOptions),
    tanstackStart({
      importProtection: {
        behavior: "error",
        client: { files: ["**/src/server/**", "**/src/db/**"] },
      },
    }),
    viteReact(),
    tailwindcss(),
  ],
});
