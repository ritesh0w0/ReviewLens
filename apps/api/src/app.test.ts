import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

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
