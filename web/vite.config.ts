import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
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
