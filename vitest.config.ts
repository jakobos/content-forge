import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@/": new URL("./src/", import.meta.url).pathname,
    },
  },
  test: {
    passWithNoTests: true,
    exclude: ["e2e/**", "**/node_modules/**"],
  },
});
