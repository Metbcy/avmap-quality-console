import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    include: [
      "lib/**/__tests__/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
  },
});
