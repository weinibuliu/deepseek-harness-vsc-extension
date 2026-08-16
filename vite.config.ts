/**
 * Vite build for the webview React app (ui/) -> dist/media/webview/.
 * The extension host bundle stays with esbuild.mjs; this config only handles
 * the webview frontend (React + Tailwind v4).
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: join(root, "ui"),
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@ui": join(root, "ui"),
    },
  },
  build: {
    outDir: join(root, "dist", "media", "webview"),
    emptyOutDir: true,
    sourcemap: true,
    // Keep @ui/favicon.svg as a real asset file instead of an inlined data URI.
    assetsInlineLimit: 0,
  },
});
