import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [
      ...configDefaults.exclude,
      "dist/**",
      "src/test/integration/**/*.integration.test.ts",
    ],
  },
});
