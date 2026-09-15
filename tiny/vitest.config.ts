import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 10_000,
    include: ["test/**/*.test.ts"],
    exclude: ["third/**", "node_modules/**"],
  },
});
