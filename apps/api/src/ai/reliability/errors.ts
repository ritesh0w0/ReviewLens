export type AIErrorCategory =
  | "RATE_LIMIT_RPM"
  | "RATE_LIMIT_RPD"
  | "TIMEOUT"
  | "NETWORK"
  | "SERVER_ERROR"
  | "BAD_REQUEST"
  | "AUTHENTICATION"
  | "MODEL_NOT_FOUND"
  | "SAFETY_REFUSAL"
  | "CIRCUIT_OPEN"
  | "UNKNOWN";

export interface ClassifiedAIError {
  readonly category: AIErrorCategory;
  readonly retryable: boolean;
  readonly message: string;
  readonly retryAfterMs?: number;
}

export function sanitizeErrorMessage(message: string): string {
  if (!message) return "";
  return message
    .replace(
      /(?:key|apiKey|token|secret|password|bearer)=[^\s&"'`]+/gi,
      "key=[REDACTED]",
    )
    .replace(/Bearer\s+[a-zA-Z0-9_.-]+/gi, "Bearer [REDACTED]")
    .replace(/AIza[a-zA-Z0-9_-]{35}/g, "[REDACTED_GEMINI_KEY]")
    .replace(/gsk_[a-zA-Z0-9_-]{30,}/g, "[REDACTED_GROQ_KEY]")
    .slice(0, 500);
}

export function classifyAIError(err: unknown): ClassifiedAIError {
  if (!err) {
    return {
      category: "UNKNOWN",
      retryable: false,
      message: "Unknown error",
    };
  }

  const rawMessage = err instanceof Error ? err.message : String(err);
  const message = sanitizeErrorMessage(rawMessage);
  const lower = rawMessage.toLowerCase();

  // Check for HTTP status code if available
  let status =
    typeof (err as { status?: number }).status === "number"
      ? (err as { status: number }).status
      : typeof (err as { statusCode?: number }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : undefined;

  if (status === undefined) {
    const codeMatch = lower.match(
      /\b(400|401|403|404|408|422|429|500|502|503|504)\b/,
    );
    if (codeMatch) {
      status = Number(codeMatch[1]);
    }
  }

  // Rate limits
  if (
    status === 429 ||
    lower.includes("rate limit") ||
    lower.includes("quota exceeded") ||
    lower.includes("resource_exhausted") ||
    lower.includes("resource exhausted")
  ) {
    if (
      lower.includes("daily") ||
      lower.includes("per day") ||
      lower.includes("quota per day") ||
      lower.includes("day limit")
    ) {
      return {
        category: "RATE_LIMIT_RPD",
        retryable: false,
        message,
      };
    }

    return {
      category: "RATE_LIMIT_RPM",
      retryable: true,
      retryAfterMs: 5000,
      message,
    };
  }

  // Authentication & permissions
  if (
    status === 401 ||
    status === 403 ||
    lower.includes("invalid api key") ||
    lower.includes("api key not valid") ||
    lower.includes("unauthenticated") ||
    lower.includes("permission denied")
  ) {
    return {
      category: "AUTHENTICATION",
      retryable: false,
      message,
    };
  }

  // Model not found
  if (
    status === 404 ||
    lower.includes("not found") ||
    lower.includes("model does not exist")
  ) {
    return {
      category: "MODEL_NOT_FOUND",
      retryable: false,
      message,
    };
  }

  // Timeouts
  if (
    status === 408 ||
    status === 504 ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("deadline exceeded")
  ) {
    return {
      category: "TIMEOUT",
      retryable: true,
      retryAfterMs: 2000,
      message,
    };
  }

  // Transient network errors
  if (
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("socket hang up") ||
    lower.includes("network error")
  ) {
    return {
      category: "NETWORK",
      retryable: true,
      retryAfterMs: 1500,
      message,
    };
  }

  // Upstream server errors
  if (
    (status && status >= 500 && status < 600) ||
    lower.includes("internal server error") ||
    lower.includes("service unavailable")
  ) {
    return {
      category: "SERVER_ERROR",
      retryable: true,
      retryAfterMs: 2500,
      message,
    };
  }

  // Content safety refusal
  if (
    lower.includes("safety") ||
    lower.includes("content filter") ||
    lower.includes("blocked by safety policy") ||
    lower.includes("refusal")
  ) {
    return {
      category: "SAFETY_REFUSAL",
      retryable: false,
      message,
    };
  }

  // Bad request / invalid JSON
  if (status === 400 || status === 422 || lower.includes("invalid argument")) {
    return {
      category: "BAD_REQUEST",
      retryable: false,
      message,
    };
  }

  return {
    category: "UNKNOWN",
    retryable: false,
    message,
  };
}
