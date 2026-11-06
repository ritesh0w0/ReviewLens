import picomatch from "picomatch";

export const SENSITIVE_PATH_PATTERNS: readonly string[] = [
  // Environment and credential files
  "**/.env",
  "**/.env.*",
  "**/*.env",
  "**/.envrc",
  "**/secrets/**",
  "**/credentials/**",
  "**/certs/**",
  "**/certificates/**",

  // Package manager and VCS credentials
  "**/.npmrc",
  "**/.pypirc",
  "**/.yarnrc",
  "**/.yarnrc.yml",
  "**/.git-credentials",
  "**/.gitconfig",

  // Cloud and container credentials
  "**/.aws/**",
  "**/.aws/credentials",
  "**/.aws/config",
  "**/.config/gcloud/**",
  "**/.azure/**",
  "**/.kube/**",
  "**/.kube/config",
  "**/.docker/config.json",
  "**/docker/config.json",

  // Terraform state and variables
  "**/*.tfstate",
  "**/*.tfstate.*",
  "**/*.tfvars",
  "**/*.tfvars.json",

  // SSH and private keys
  "**/.ssh/**",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/id_ecdsa*",
  "**/id_dsa*",
  "**/*.pem",
  "**/*.key",
  "**/*.pkcs12",
  "**/*.pfx",
  "**/*.p12",

  // Auth / Keyrings / Keystores
  "**/.htpasswd",
  "**/.netrc",
  "**/*.kdbx",
  "**/*.keystore",
  "**/*.jks",

  // Binary databases and memory dumps
  "**/*.sqlite",
  "**/*.sqlite3",
  "**/*.db",
  "**/*.dump",
  "**/*.core",
  "**/*.dmp",

  // Compressed archives (binary / non-reviewable context)
  "**/*.zip",
  "**/*.tar",
  "**/*.tar.gz",
  "**/*.tgz",
  "**/*.rar",
  "**/*.7z",

  // Minified bundles
  "**/*.min.js",
  "**/*.min.css",
];

const matchers = SENSITIVE_PATH_PATTERNS.map((pattern) =>
  picomatch(pattern, { dot: true, nocase: true }),
);

export function isSensitivePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").trim();
  const lower = normalized.toLowerCase();

  for (const matcher of matchers) {
    if (matcher(lower)) {
      return true;
    }
  }

  // Common basename patterns
  const base = lower.split("/").pop() ?? "";
  if (
    base.startsWith(".env") ||
    base.endsWith(".key") ||
    base.endsWith(".pem") ||
    base === "credentials.json" ||
    base === "service-account.json"
  ) {
    return true;
  }

  return false;
}

export interface PathCheckable {
  readonly path: string;
  readonly oldPath?: string;
}

export interface PathFilterResult<T extends PathCheckable> {
  readonly safe: readonly T[];
  readonly excluded: readonly { readonly file: T; readonly reason: string }[];
}

export function filterSensitiveFiles<T extends PathCheckable>(
  files: readonly T[],
): PathFilterResult<T> {
  const safe: T[] = [];
  const excluded: { file: T; reason: string }[] = [];

  for (const file of files) {
    if (isSensitivePath(file.path)) {
      excluded.push({
        file,
        reason: `File path matches sensitive pattern: ${file.path}`,
      });
      continue;
    }

    if (file.oldPath && isSensitivePath(file.oldPath)) {
      excluded.push({
        file,
        reason: `Previous file path matches sensitive pattern: ${file.oldPath}`,
      });
      continue;
    }

    safe.push(file);
  }

  return { safe, excluded };
}
