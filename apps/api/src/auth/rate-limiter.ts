import type { Request, Response, NextFunction } from "express";

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  message?: string;
}

interface ClientRecord {
  timestamps: number[];
}

/**
 * In-memory sliding-window rate limiter for sensitive authentication endpoints.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const clients = new Map<string, ClientRecord>();
  const {
    windowMs,
    maxRequests,
    message = "Too many requests, please try again later.",
  } = options;

  // Cleanup old records periodically to avoid memory growth
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of clients.entries()) {
      record.timestamps = record.timestamps.filter((t) => now - t < windowMs);
      if (record.timestamps.length === 0) {
        clients.delete(ip);
      }
    }
  }, windowMs).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "127.0.0.1";
    const now = Date.now();

    let record = clients.get(ip);
    if (!record) {
      record = { timestamps: [] };
      clients.set(ip, record);
    }

    // Filter out timestamps outside the sliding window
    record.timestamps = record.timestamps.filter((t) => now - t < windowMs);

    if (record.timestamps.length >= maxRequests) {
      const oldest = record.timestamps[0] ?? now;
      const retryAfterSec = Math.ceil((oldest + windowMs - now) / 1000);
      res.setHeader("Retry-After", Math.max(1, retryAfterSec));
      return res.status(429).json({
        error: message,
      });
    }

    record.timestamps.push(now);
    next();
  };
}
