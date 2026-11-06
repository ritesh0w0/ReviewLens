import { describe, expect, it } from "vitest";
import {
  classifyError,
  TransientError,
  PermanentError,
} from "../workers/errors.js";

describe("Targeted Error Classification (Part 9)", () => {
  it("classifies explicit TransientError and PermanentError instances", () => {
    const t = new TransientError("Network flap", 30);
    const p = new PermanentError("Schema invalid");

    expect(classifyError(t).isTransient).toBe(true);
    expect(classifyError(p).isTransient).toBe(false);
  });

  it("classifies 403 permission denied as permanent", () => {
    const err = new Error("Resource not accessible by integration");
    (err as unknown as { status: number }).status = 403;

    const classified = classifyError(err);
    expect(classified.isTransient).toBe(false);
    expect(classified.statusCode).toBe(403);
  });

  it("classifies 403 primary rate limit as transient", () => {
    const err = new Error("API rate limit exceeded for user");
    (err as unknown as { status: number }).status = 403;

    const classified = classifyError(err);
    expect(classified.isTransient).toBe(true);
    expect(classified.statusCode).toBe(403);
  });

  it("classifies 403 secondary rate limit as transient", () => {
    const err = new Error(
      "You have exceeded a secondary rate limit. Please wait a few minutes.",
    );
    (err as unknown as { status: number }).status = 403;

    const classified = classifyError(err);
    expect(classified.isTransient).toBe(true);
    expect(classified.statusCode).toBe(403);
  });

  it("classifies 403 with x-ratelimit-remaining: 0 as transient", () => {
    const err = new Error("Forbidden");
    (
      err as unknown as {
        status: number;
        response: { headers: Record<string, string> };
      }
    ).status = 403;
    (
      err as unknown as { response: { headers: Record<string, string> } }
    ).response = {
      headers: { "x-ratelimit-remaining": "0" },
    };

    const classified = classifyError(err);
    expect(classified.isTransient).toBe(true);
  });

  it("classifies 429 Too Many Requests as transient and parses Retry-After header", () => {
    const err = new Error("Too Many Requests");
    (
      err as unknown as {
        status: number;
        response: { headers: Record<string, string> };
      }
    ).status = 429;
    (
      err as unknown as { response: { headers: Record<string, string> } }
    ).response = {
      headers: { "retry-after": "60" },
    };

    const classified = classifyError(err);
    expect(classified.isTransient).toBe(true);
    expect(classified.statusCode).toBe(429);
    expect(classified.retryAfterSeconds).toBe(60);
  });

  it("classifies 500, 502, 503, 504 server errors as transient", () => {
    for (const status of [500, 502, 503, 504]) {
      const err = new Error(`Server Error ${status}`);
      (err as unknown as { status: number }).status = status;

      const classified = classifyError(err);
      expect(classified.isTransient).toBe(true);
      expect(classified.statusCode).toBe(status);
    }
  });

  it("classifies 401, 404, 422 as permanent", () => {
    for (const status of [401, 404, 422]) {
      const err = new Error(`Client Error ${status}`);
      (err as unknown as { status: number }).status = status;

      const classified = classifyError(err);
      expect(classified.isTransient).toBe(false);
      expect(classified.statusCode).toBe(status);
    }
  });

  it("classifies low-level network errors as transient", () => {
    expect(
      classifyError(new Error("connect ECONNREFUSED 127.0.0.1")).isTransient,
    ).toBe(true);
    expect(classifyError(new Error("socket hang up")).isTransient).toBe(true);
    expect(
      classifyError(new Error("ETIMEDOUT: connection timed out")).isTransient,
    ).toBe(true);
  });
});
