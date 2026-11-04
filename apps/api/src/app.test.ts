import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { createMockPrismaClient } from "./test/mock-prisma.js";

describe("GET /healthz", () => {
  it("returns a healthy status", async () => {
    const response = await request(createApp()).get("/healthz");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "reviewlens-api",
    });
  });
});

describe("GET /readyz", () => {
  it("returns ready when the database is reachable", async () => {
    const mockPrisma = createMockPrismaClient();
    const response = await request(createApp({ prisma: mockPrisma })).get(
      "/readyz",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ready",
      service: "reviewlens-api",
      database: "connected",
    });
  });

  it("returns 503 not ready when the database is unreachable", async () => {
    const mockPrisma = createMockPrismaClient();
    mockPrisma._storage.shouldFail = true;

    const response = await request(createApp({ prisma: mockPrisma })).get(
      "/readyz",
    );

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: "not_ready",
      service: "reviewlens-api",
      database: "disconnected",
    });
  });
});
