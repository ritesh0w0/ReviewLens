import fs from "node:fs";

export const SECRET_ENV_VARS = [
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "DATABASE_URL_TEST",
  "DIRECT_DATABASE_URL_TEST",
  "GITHUB_APP_ID",
  "GITHUB_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "SESSION_SECRET",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
] as const;

/**
 * Loads secret values from files specified by <VAR_NAME>_FILE environment variables.
 * If the environment variable is not set but its corresponding _FILE variable is set
 * and references an existing file, the file's contents are trimmed and populated into process.env.
 */
export function loadFileSecrets(): void {
  for (const envName of SECRET_ENV_VARS) {
    const fileEnvName = `${envName}_FILE`;
    const filePath = process.env[fileEnvName];
    if (filePath && !process.env[envName]) {
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf8").trim();
          if (content.length > 0) {
            process.env[envName] = content;
          }
        }
      } catch (err) {
        console.error(
          `Failed to read secret file for ${fileEnvName} at ${filePath}:`,
          err,
        );
      }
    }
  }
}
