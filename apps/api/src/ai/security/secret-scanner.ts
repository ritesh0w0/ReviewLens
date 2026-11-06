const PRIVATE_KEY_BLOCK_REGEX =
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/gi;

const GITHUB_TOKEN_REGEX =
  /\b(?:ghp_[a-zA-Z0-9]{36,40}|gho_[a-zA-Z0-9]{36,40}|github_pat_[a-zA-Z0-9_]{40,90})\b/g;

const AWS_ACCESS_KEY_REGEX = /\b(AKIA[0-9A-Z]{16})\b/g;

const SLACK_TOKEN_REGEX =
  /\b(xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*)\b/g;

const GOOGLE_API_KEY_REGEX = /\b(AIza[0-9A-Za-z\-_]{30,35})\b/g;

const DB_CONNECTION_STRING_REGEX =
  /\b((?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^:\s/]+:)([^@\s/]+)(@[^ \s/]+)/gi;

const AUTH_HEADER_REGEX =
  /(Authorization:\s*(?:Bearer|Basic)\s+)[a-zA-Z0-9._~+/-]+=*/gi;

export const REDACTED_MARKER = "[REDACTED_SECRET]";

export function containsPrivateKeyBlock(text: string): boolean {
  PRIVATE_KEY_BLOCK_REGEX.lastIndex = 0;
  return PRIVATE_KEY_BLOCK_REGEX.test(text);
}

export interface ContentSanitizationResult {
  readonly action: "keep" | "exclude_file";
  readonly content: string;
  readonly redactedCount: number;
  readonly reason?: string;
}

export function scanAndSanitizeContent(
  text: string,
): ContentSanitizationResult {
  if (containsPrivateKeyBlock(text)) {
    return {
      action: "exclude_file",
      content: "",
      redactedCount: 0,
      reason: "File contains private key block header",
    };
  }

  let redactedCount = 0;
  let sanitized = text;

  // Redact GitHub tokens
  sanitized = sanitized.replace(GITHUB_TOKEN_REGEX, () => {
    redactedCount++;
    return REDACTED_MARKER;
  });

  // Redact AWS access keys
  sanitized = sanitized.replace(AWS_ACCESS_KEY_REGEX, () => {
    redactedCount++;
    return REDACTED_MARKER;
  });

  // Redact Slack tokens
  sanitized = sanitized.replace(SLACK_TOKEN_REGEX, () => {
    redactedCount++;
    return REDACTED_MARKER;
  });

  // Redact Google API keys
  sanitized = sanitized.replace(GOOGLE_API_KEY_REGEX, () => {
    redactedCount++;
    return REDACTED_MARKER;
  });

  // Redact DB passwords in connection strings
  sanitized = sanitized.replace(
    DB_CONNECTION_STRING_REGEX,
    (_match, prefix, _password, suffix) => {
      redactedCount++;
      return `${prefix}${REDACTED_MARKER}${suffix}`;
    },
  );

  // Redact Authorization headers
  sanitized = sanitized.replace(AUTH_HEADER_REGEX, (_match, prefix) => {
    redactedCount++;
    return `${prefix}${REDACTED_MARKER}`;
  });

  return {
    action: "keep",
    content: sanitized,
    redactedCount,
  };
}

export function sanitizeSecretOccurrencesInProse(text: string): string {
  const result = scanAndSanitizeContent(text);
  if (result.action === "exclude_file") {
    return "[CONTENT EXCLUDED DUE TO DETECTED PRIVATE KEY]";
  }
  return result.content;
}
