import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestPrismaClient,
  disconnectTestPrismaClient,
} from "./test-db-client.js";

describe("Real PostgreSQL: Schema and Migrations", () => {
  const prisma = getTestPrismaClient();

  beforeAll(async () => {
    // Quick connectivity verify
    await prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    await disconnectTestPrismaClient();
  });

  it("verifies that Prisma migration table recorded successful migration", async () => {
    const migrations = await prisma.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null }>
    >`SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name = '20261022133000_init_m1_2_persistence'`;

    expect(migrations.length).toBe(1);
    expect(migrations[0]?.migration_name).toBe(
      "20261022133000_init_m1_2_persistence",
    );
    expect(migrations[0]?.finished_at).not.toBeNull();
  });

  it("verifies that all application tables exist in PostgreSQL public schema", async () => {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('installations', 'repositories', 'webhook_deliveries', 'review_runs')
      ORDER BY table_name;
    `;

    const tableNames = tables.map((t) => t.table_name);
    expect(tableNames).toContain("installations");
    expect(tableNames).toContain("repositories");
    expect(tableNames).toContain("webhook_deliveries");
    expect(tableNames).toContain("review_runs");
  });

  it("verifies that PostgreSQL custom enum types exist", async () => {
    const enums = await prisma.$queryRaw<Array<{ typname: string }>>`
      SELECT typname 
      FROM pg_type 
      WHERE typname IN ('installation_status', 'delivery_status', 'review_status', 'review_trigger')
      ORDER BY typname;
    `;

    const enumNames = enums.map((e) => e.typname);
    expect(enumNames).toContain("installation_status");
    expect(enumNames).toContain("delivery_status");
    expect(enumNames).toContain("review_status");
    expect(enumNames).toContain("review_trigger");
  });
});
