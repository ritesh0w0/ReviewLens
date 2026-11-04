export interface ValidatedTestDbConfig {
  databaseUrl: string;
  directDatabaseUrl: string;
  host: string;
  port: number;
  database: string;
}

const ALLOWED_TEST_HOSTS = new Set(["127.0.0.1", "localhost", "postgres"]);
const ALLOWED_TEST_PORTS = new Set([5432, 55432]);
const REQUIRED_TEST_DB_NAME = "reviewlens_test";

export function validateAndApplyTestDbEnvironment(): ValidatedTestDbConfig {
  const rawUrl = process.env.DATABASE_URL_TEST;
  if (!rawUrl || rawUrl.trim() === "") {
    throw new Error(
      "Safety guard: DATABASE_URL_TEST is not configured. Integration tests must not run without an explicit test database URL.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(
      "Safety guard: DATABASE_URL_TEST is malformed and could not be parsed as a URL.",
    );
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(
      `Safety guard: DATABASE_URL_TEST must use postgresql: protocol, found: ${parsed.protocol}`,
    );
  }

  const host = parsed.hostname;
  if (!ALLOWED_TEST_HOSTS.has(host)) {
    throw new Error(
      `Safety guard: Database host '${host}' is not in the approved test hosts list ([127.0.0.1, localhost, postgres]). Refusing to connect to remote or unapproved database.`,
    );
  }

  const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
  if (!ALLOWED_TEST_PORTS.has(port)) {
    throw new Error(
      `Safety guard: Database port ${port} is not in the approved test ports list ([5432, 55432]). Refusing to connect.`,
    );
  }

  const dbName = parsed.pathname.replace(/^\//, "");
  if (dbName !== REQUIRED_TEST_DB_NAME) {
    throw new Error(
      `Safety guard: Database target must be exactly '${REQUIRED_TEST_DB_NAME}', but target was '${dbName}'. Refusing to run tests against non-test database!`,
    );
  }

  const rawDirectUrl = process.env.DIRECT_DATABASE_URL_TEST || rawUrl;
  let parsedDirect: URL;
  try {
    parsedDirect = new URL(rawDirectUrl);
  } catch {
    throw new Error(
      "Safety guard: DIRECT_DATABASE_URL_TEST is malformed and could not be parsed as a URL.",
    );
  }

  const directDbName = parsedDirect.pathname.replace(/^\//, "");
  if (directDbName !== REQUIRED_TEST_DB_NAME) {
    throw new Error(
      `Safety guard: DIRECT_DATABASE_URL_TEST database must be exactly '${REQUIRED_TEST_DB_NAME}', but target was '${directDbName}'.`,
    );
  }

  // Set Prisma environment variables for the test process
  process.env.DATABASE_URL = rawUrl;
  process.env.DIRECT_DATABASE_URL = rawDirectUrl;

  return {
    databaseUrl: rawUrl,
    directDatabaseUrl: rawDirectUrl,
    host,
    port,
    database: dbName,
  };
}
