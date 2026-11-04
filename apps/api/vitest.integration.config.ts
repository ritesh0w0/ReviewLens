import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/test/integration/**/*.integration.test.ts"],
    exclude: [...configDefaults.exclude, "dist/**"],
    testTimeout: 15000,
    fileParallelism: false,
  },
});
