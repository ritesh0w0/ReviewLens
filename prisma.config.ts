import { defineConfig } from "prisma/config";
import "dotenv/config";

// Migration URL for Prisma CLI commands:
// Prefers DIRECT_DATABASE_URL (for migrations bypassing poolers), falling back to DATABASE_URL.
// Fails closed (undefined) when neither is configured, ensuring migration commands fail explicitly
// rather than silently connecting to an arbitrary fallback database.
const migrationUrl =
  process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || undefined;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrationUrl,
  },
});
