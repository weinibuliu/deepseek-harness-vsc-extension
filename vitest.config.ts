import { defineConfig } from "vitest/config";

export default defineConfig({
  // Webview specs use the automatic JSX runtime (tsconfig.webview.json `jsx: react-jsx`).
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.ts", "ui/src/**/*.spec.{ts,tsx}"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
