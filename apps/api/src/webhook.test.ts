import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

const testSecret = "reviewlens-test-secret";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", testSecret)
    .update(body)
    .digest("hex")}`;
}

describe("POST /webhooks/github", () => {
  it("accepts a correctly signed JSON payload", async () => {
    const body = '{"action":"opened","number":1}';

    const response = await request(createApp({ webhookSecret: testSecret }))
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", "test-delivery-1")
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.received).toBe(true);
    expect(response.body.event).toBe("pull_request");
    expect(response.body.deliveryId).toBe("test-delivery-1");
  });

  it("rejects a payload with an invalid signature", async () => {
    const body = '{"action":"opened"}';

    const response = await request(createApp({ webhookSecret: testSecret }))
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", "sha256=invalid")
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", "test-delivery-2")
      .send(body);

    expect(response.status).toBe(401);
  });

  it("rejects a request when the webhook secret is missing", async () => {
    const response = await request(createApp())
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .send("{}");

    expect(response.status).toBe(503);
  });

  it("rejects malformed JSON even when the signature is valid", async () => {
    const body = "this is not JSON";

    const response = await request(createApp({ webhookSecret: testSecret }))
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "ping")
      .set("X-GitHub-Delivery", "test-delivery-3")
      .send(body);

    expect(response.status).toBe(400);
  });
});
