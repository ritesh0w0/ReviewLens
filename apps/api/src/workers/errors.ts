export class TransientError extends Error {
  public readonly isTransient = true;
  public readonly retryAfterSeconds?: number;

  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "TransientError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class PermanentError extends Error {
  public readonly isTransient = false;

  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

export function classifyError(err: unknown): {
  isTransient: boolean;
  message: string;
  statusCode?: number;
  retryAfterSeconds?: number;
} {
  if (err instanceof TransientError) {
    return { isTransient: true, message: err.message };
  }

  if (err instanceof PermanentError) {
    return { isTransient: false, message: err.message };
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();

    // Check for explicit GitHub Octokit HTTP status codes
    const status = (err as unknown as { status?: number }).status;
    const responseHeaders = (
      err as unknown as {
        response?: { headers?: Record<string, string | number | undefined> };
      }
    ).response?.headers;

    const remaining = responseHeaders?.["x-ratelimit-remaining"];
    const retryAfter = responseHeaders?.["retry-after"];
    const hasRateLimitHeader =
      (remaining !== undefined && String(remaining) === "0") ||
      retryAfter !== undefined;

    let retryAfterSeconds: number | undefined;
    if (typeof retryAfter === "number") {
      retryAfterSeconds = retryAfter;
    } else if (typeof retryAfter === "string") {
      const parsed = parseInt(retryAfter, 10);
      if (!isNaN(parsed)) retryAfterSeconds = parsed;
    }

    if (typeof status === "number") {
      // 401 Unauthorized, 404 Not Found, 422 Unprocessable are permanent
      if (status === 401 || status === 404 || status === 422) {
        return { isTransient: false, message: err.message, statusCode: status };
      }

      // 403 can be rate limit (transient) or permission denial (permanent)
      if (status === 403) {
        const isRateLimit =
          hasRateLimitHeader ||
          msg.includes("rate limit") ||
          msg.includes("secondary rate") ||
          msg.includes("abuse detection");

        return {
          isTransient: isRateLimit,
          message: err.message,
          statusCode: status,
          retryAfterSeconds: isRateLimit ? retryAfterSeconds : undefined,
        };
      }

      // 429 Too Many Requests, 500, 502, 503, 504 are transient
      if (status === 429 || (status >= 500 && status < 600)) {
        return {
          isTransient: true,
          message: err.message,
          statusCode: status,
          retryAfterSeconds,
        };
      }
    }

    // Network / Socket / DNS transient errors
    if (
      msg.includes("econnrefused") ||
      msg.includes("etimedout") ||
      msg.includes("econnreset") ||
      msg.includes("enotfound") ||
      msg.includes("socket hang up") ||
      msg.includes("network timeout") ||
      msg.includes("server unavailable")
    ) {
      return { isTransient: true, message: err.message };
    }

    return { isTransient: false, message: err.message };
  }

  return { isTransient: false, message: String(err) };
}

export function isInlineCoordinate422Error(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: number }).status;
  if (status !== 422) return false;

  const msg = ((err as { message?: string }).message || "").toLowerCase();
  const respData = (err as { response?: { data?: unknown } }).response?.data;
  const dataStr =
    typeof respData === "object" ? JSON.stringify(respData).toLowerCase() : "";

  const combined = `${msg} ${dataStr}`;

  // Spam, abuse, or invalid review event are never coordinate errors
  if (
    combined.includes("spam") ||
    combined.includes("abuse") ||
    combined.includes("event")
  ) {
    return false;
  }

  // Specific inline-coordinate markers
  return (
    combined.includes("comments") ||
    combined.includes("path") ||
    combined.includes("line") ||
    combined.includes("side") ||
    combined.includes("diff") ||
    combined.includes("pull_request_review_thread")
  );
}

export function isAmbiguousNetworkError(err: unknown): boolean {
  if (!err || !(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("network timeout") ||
    msg.includes("timeout")
  );
}
