import { defineConfig, configDefaults } from "vitest/config";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

// Load .env and apps/api/.env for integration test execution
const rootEnv = path.resolve(process.cwd(), ".env");
const apiEnv = path.resolve(process.cwd(), "apps/api/.env");
if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });
if (fs.existsSync(apiEnv)) dotenv.config({ path: apiEnv });

export default defineConfig({
  test: {
    include: ["src/test/integration/**/*.integration.test.ts"],
    exclude: [...configDefaults.exclude, "dist/**"],
    testTimeout: 15000,
    fileParallelism: false,
  },
});
