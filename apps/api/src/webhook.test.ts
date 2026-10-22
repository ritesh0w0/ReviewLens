import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { DeliveryStatus, ReviewStatus } from "@prisma/client";
import { createApp } from "./app.js";
import { createMockPrismaClient } from "./test/mock-prisma.js";

const testSecret = "reviewlens-test-secret";

function sign(body: string, secret: string = testSecret): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function createValidPullRequestPayload(
  overrides: Record<string, unknown> = {},
) {
  return {
    action: "opened",
    number: 101,
    pull_request: {
      number: 101,
      draft: false,
      head: {
        sha: "a1b2c3d4e5f678901234567890abcdef12345678",
        ref: "feature-branch",
      },
      base: {
        sha: "f6e5d4c3b2a10987654321fedcba09876543210f",
        ref: "main",
      },
      user: {
        login: "maya-dev",
        type: "User",
      },
    },
    repository: {
      id: 998877,
      full_name: "maya/reviewlens-demo",
      default_branch: "main",
      owner: {
        login: "maya",
      },
    },
    installation: {
      id: 554433,
      account: {
        login: "maya",
        type: "User",
      },
    },
    ...overrides,
  };
}

describe("POST /webhooks/github - M1.2 Persistence & Idempotency", () => {
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
  });

  it("1. Valid webhook signature and valid payload persist the expected records and return 202", async () => {
    const payload = createValidPullRequestPayload();
    const body = JSON.stringify(payload);
    const deliveryId = "delivery-valid-01";

    const response = await request(
      createApp({ webhookSecret: testSecret, prisma: mockPrisma }),
    )
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", deliveryId)
      .send(body);

    expect(response.status).toBe(202);
    expect(response.body.received).toBe(true);
    expect(response.body.deliveryId).toBe(deliveryId);
    expect(response.body.status).toBe("queued");
    expect(response.body.runId).toBeDefined();

    // Verify delivery persisted in database
    const delivery = mockPrisma._storage.webhookDeliveries.get(deliveryId);
    expect(delivery).toBeDefined();
    expect(delivery!.status).toBe(DeliveryStatus.RECEIVED);
    expect(delivery!.event).toBe("pull_request");
    expect(delivery!.action).toBe("opened");
    expect(delivery!.reviewRunId).toBe(response.body.runId);

    // Verify installation and repository persisted
    const installation = mockPrisma._storage.installations.get("554433");
    expect(installation).toBeDefined();
    expect(installation!.accountLogin).toBe("maya");

    const repo = mockPrisma._storage.repositories.get("998877");
    expect(repo).toBeDefined();
    expect(repo!.fullName).toBe("maya/reviewlens-demo");

    // Verify review run persisted
    const runKey = `${repo!.id}:101:${payload.pull_request.head.sha}:${payload.pull_request.base.sha}`;
    const run = mockPrisma._storage.reviewRuns.get(runKey);
    expect(run).toBeDefined();
    expect(run!.status).toBe(ReviewStatus.QUEUED);
    expect(run!.prNumber).toBe(101);
    expect(run!.baseSha).toBe(payload.pull_request.base.sha);
  });

  it("2. Invalid signature returns 401 and persists nothing", async () => {
    const payload = createValidPullRequestPayload();
    const body = JSON.stringify(payload);
    const deliveryId = "delivery-bad-sig";

    const response = await request(
      createApp({ webhookSecret: testSecret, prisma: mockPrisma }),
    )
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set(
        "X-Hub-Signature-256",
        "sha256=badsignature0000000000000000000000000000000000000000000000000000",
      )
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", deliveryId)
      .send(body);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid webhook signature");
    expect(mockPrisma._storage.webhookDeliveries.size).toBe(0);
    expect(mockPrisma._storage.reviewRuns.size).toBe(0);
  });

  it("3. Malformed payload returns 400 and creates no review run", async () => {
    const body = "this is not JSON";
    const deliveryId = "delivery-malformed";

    const response = await request(
      createApp({ webhookSecret: testSecret, prisma: mockPrisma }),
    )
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", deliveryId)
      .send(body);

    expect(response.status).toBe(400);
    expect(mockPrisma._storage.reviewRuns.size).toBe(0);
  });

  it("4. The same delivery ID sent repeatedly creates one delivery and no duplicate run", async () => {
    const payload = createValidPullRequestPayload();
    const body = JSON.stringify(payload);
    const deliveryId = "delivery-duplicate-id";

    const app = createApp({ webhookSecret: testSecret, prisma: mockPrisma });

    // First delivery attempt
    const firstRes = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", deliveryId)
      .send(body);

    expect(firstRes.status).toBe(202);
    expect(mockPrisma._storage.webhookDeliveries.size).toBe(1);
    expect(mockPrisma._storage.reviewRuns.size).toBe(1);

    // Repeated delivery with identical delivery ID
    const secondRes = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", deliveryId)
      .send(body);

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.duplicate).toBe(true);
    expect(mockPrisma._storage.webhookDeliveries.size).toBe(1);
    expect(mockPrisma._storage.reviewRuns.size).toBe(1);
  });

  it("5. Different delivery IDs for the same repository, PR, and head SHA result in exactly one logical review run", async () => {
    const payload = createValidPullRequestPayload();
    const body = JSON.stringify(payload);

    const app = createApp({ webhookSecret: testSecret, prisma: mockPrisma });

    // Delivery A
    const resA = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", "delivery-A")
      .send(body);

    expect(resA.status).toBe(202);
    expect(mockPrisma._storage.reviewRuns.size).toBe(1);

    // Delivery B (different delivery ID, e.g. redelivery or ready_for_review at same SHA)
    const resB = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", "delivery-B")
      .send(body);

    expect(resB.status).toBe(200);
    expect(resB.body.duplicate).toBe(true);
    // Both deliveries are tracked
    expect(mockPrisma._storage.webhookDeliveries.size).toBe(2);
    // But only one review run exists
    expect(mockPrisma._storage.reviewRuns.size).toBe(1);
  });

  it("6. Different head SHAs for the same PR result in distinct logical runs", async () => {
    const app = createApp({ webhookSecret: testSecret, prisma: mockPrisma });

    // Commit 1
    const payload1 = createValidPullRequestPayload();
    const body1 = JSON.stringify(payload1);
    const res1 = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body1))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", "delivery-sha-1")
      .send(body1);

    expect(res1.status).toBe(202);
    const runId1 = res1.body.runId;

    // Commit 2 (new commits pushed: synchronize event with new head SHA)
    const payload2 = createValidPullRequestPayload({
      action: "synchronize",
      pull_request: {
        ...payload1.pull_request,
        head: {
          sha: "b2c3d4e5f6a10987654321fedcba09876543210f",
          ref: "feature-branch",
        },
      },
    });
    const body2 = JSON.stringify(payload2);

    const res2 = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body2))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", "delivery-sha-2")
      .send(body2);

    expect(res2.status).toBe(202);
    const runId2 = res2.body.runId;
    expect(runId1).not.toBe(runId2);
    expect(mockPrisma._storage.reviewRuns.size).toBe(2);
  });

  it("6b. Different base SHAs for the same PR and head SHA result in distinct logical runs", async () => {
    const app = createApp({ webhookSecret: testSecret, prisma: mockPrisma });

    const payload1 = createValidPullRequestPayload();
    const body1 = JSON.stringify(payload1);
    const res1 = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body1))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", "delivery-base-1")
      .send(body1);

    expect(res1.status).toBe(202);
    const runId1 = res1.body.runId;

    // Same head SHA, but base SHA changes (e.g. target branch updated)
    const payload2 = createValidPullRequestPayload({
      pull_request: {
        ...payload1.pull_request,
        base: {
          sha: "c3d4e5f6a10987654321fedcba09876543210fab",
          ref: "main",
        },
      },
    });
    const body2 = JSON.stringify(payload2);

    const res2 = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body2))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", "delivery-base-2")
      .send(body2);

    expect(res2.status).toBe(202);
    const runId2 = res2.body.runId;
    expect(runId1).not.toBe(runId2);
    expect(mockPrisma._storage.reviewRuns.size).toBe(2);
  });

  it("7. Concurrent requests cannot bypass the database unique constraints", async () => {
    const payload = createValidPullRequestPayload();
    const body = JSON.stringify(payload);
    const app = createApp({ webhookSecret: testSecret, prisma: mockPrisma });

    // Fire 5 simultaneous requests with different delivery IDs for the exact same PR & SHA
    const requests = Array.from({ length: 5 }, (_, i) =>
      request(app)
        .post("/webhooks/github")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", sign(body))
        .set("X-GitHub-Event", "pull_request")
        .set("X-GitHub-Delivery", `concurrent-delivery-${i}`)
        .send(body),
    );

    const responses = await Promise.all(requests);

    // Exactly one must return 202 (new accepted work) and the rest 200 (duplicate run)
    const acceptedCount = responses.filter((r) => r.status === 202).length;
    const duplicateCount = responses.filter(
      (r) => r.status === 200 && r.body.duplicate === true,
    ).length;

    expect(acceptedCount).toBe(1);
    expect(duplicateCount).toBe(4);
    expect(mockPrisma._storage.reviewRuns.size).toBe(1);
  });

  it("8. An ignored action is recorded appropriately without creating a review run", async () => {
    const app = createApp({ webhookSecret: testSecret, prisma: mockPrisma });

    // 8a. Unsupported action: "closed"
    const closedPayload = createValidPullRequestPayload({ action: "closed" });
    const closedBody = JSON.stringify(closedPayload);
    const resClosed = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(closedBody))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", "delivery-closed")
      .send(closedBody);

    expect(resClosed.status).toBe(200);
    expect(resClosed.body.ignored).toBe(true);
    expect(mockPrisma._storage.reviewRuns.size).toBe(0);

    const deliveryClosed =
      mockPrisma._storage.webhookDeliveries.get("delivery-closed");
    expect(deliveryClosed).toBeDefined();
    expect(deliveryClosed!.status).toBe(DeliveryStatus.IGNORED);

    // 8b. Draft pull request
    const draftPayload = createValidPullRequestPayload({
      pull_request: {
        ...createValidPullRequestPayload().pull_request,
        draft: true,
      },
    });
    const draftBody = JSON.stringify(draftPayload);
    const resDraft = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(draftBody))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", "delivery-draft")
      .send(draftBody);

    expect(resDraft.status).toBe(200);
    expect(resDraft.body.ignored).toBe(true);
    expect(mockPrisma._storage.reviewRuns.size).toBe(0);

    // 8c. Non-pull_request event: "ping"
    const pingPayload = { zen: "Design for failure." };
    const pingBody = JSON.stringify(pingPayload);
    const resPing = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(pingBody))
      .set("X-GitHub-Event", "ping")
      .set("X-GitHub-Delivery", "delivery-ping")
      .send(pingBody);

    expect(resPing.status).toBe(200);
    expect(resPing.body.ignored).toBe(true);
    expect(mockPrisma._storage.reviewRuns.size).toBe(0);
  });

  it("9. Database unavailability produces a controlled 503 response without leaking connection details or secrets", async () => {
    mockPrisma._storage.shouldFail = true;

    const payload = createValidPullRequestPayload();
    const body = JSON.stringify(payload);

    const response = await request(
      createApp({ webhookSecret: testSecret, prisma: mockPrisma }),
    )
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", "delivery-db-fail")
      .send(body);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "Database service unavailable",
    });
    // Ensure no connection strings or internal errors are exposed in the JSON response
    expect(JSON.stringify(response.body)).not.toContain("localhost:5432");
    expect(JSON.stringify(response.body)).not.toContain("password");
  });

  it("10. Existing signature-verification tests continue to pass", async () => {
    const payload = createValidPullRequestPayload();
    const body = JSON.stringify(payload);

    // Missing secret
    const resNoSecret = await request(createApp({ prisma: mockPrisma }))
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .send(body);

    expect(resNoSecret.status).toBe(503);
    expect(resNoSecret.body.error).toBe("Webhook secret is not configured");

    // Missing headers
    const resNoHeaders = await request(
      createApp({ webhookSecret: testSecret, prisma: mockPrisma }),
    )
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body);

    expect(resNoHeaders.status).toBe(400);
    expect(resNoHeaders.body.error).toBe("Missing GitHub event headers");
  });
});
