import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import {
  getTestPrismaClient,
  disconnectTestPrismaClient,
  cleanUpTestRecords,
} from "./test-db-client.js";

const testSecret = "integration-webhook-secret-xyz";

function sign(body: string, secret: string = testSecret): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("Real PostgreSQL: Webhook Persistence & Lifecycle", () => {
  const prisma = getTestPrismaClient();
  const app = createApp({ webhookSecret: testSecret, prisma });

  const createdDeliveryIds: string[] = [];
  const createdReviewRunIds: string[] = [];
  const createdRepoIds: string[] = [];
  const createdInstIds: string[] = [];

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  afterEach(async () => {
    await cleanUpTestRecords(prisma, {
      deliveryIds: [...createdDeliveryIds],
      reviewRunIds: [...createdReviewRunIds],
      repositoryIds: [...createdRepoIds],
      installationIds: [...createdInstIds],
    });
    createdDeliveryIds.length = 0;
    createdReviewRunIds.length = 0;
    createdRepoIds.length = 0;
    createdInstIds.length = 0;
  });

  afterAll(async () => {
    await disconnectTestPrismaClient();
  });

  function makePayload(overrides: Record<string, unknown> = {}) {
    const uniqueSuffix = Math.floor(Math.random() * 1000000);
    return {
      action: "opened",
      number: 42,
      pull_request: {
        number: 42,
        draft: false,
        head: {
          sha: `head-sha-${uniqueSuffix}`,
          ref: "feature-branch",
        },
        base: {
          sha: `base-sha-${uniqueSuffix}`,
          ref: "main",
        },
        user: {
          login: "test-author",
          type: "User",
        },
      },
      repository: {
        id: 700000 + uniqueSuffix,
        full_name: `test-org/repo-${uniqueSuffix}`,
        default_branch: "main",
        owner: {
          login: "test-org",
        },
      },
      installation: {
        id: 800000 + uniqueSuffix,
        account: {
          login: "test-org",
          type: "Organization",
        },
      },
      ...overrides,
    };
  }

  it("processes valid webhook, persisting installation, repo, delivery, and review run", async () => {
    const payloadObj = makePayload();
    const rawBody = JSON.stringify(payloadObj);
    const signature = sign(rawBody);
    const deliveryId = `del-int-valid-${Date.now()}`;
    createdDeliveryIds.push(deliveryId);

    const res = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("x-hub-signature-256", signature)
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", deliveryId)
      .send(rawBody);

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("queued");
    expect(res.body.runId).toBeDefined();

    const reviewRunId = res.body.runId as string;
    createdReviewRunIds.push(reviewRunId);

    // Verify delivery in PostgreSQL
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { deliveryId },
    });
    expect(delivery).not.toBeNull();
    expect(delivery!.status).toBe("RECEIVED");
    expect(delivery!.attemptCount).toBe(1);
    expect(delivery!.reviewRunId).toBe(reviewRunId);

    // Verify installation in PostgreSQL
    const inst = await prisma.installation.findUnique({
      where: { githubInstallationId: BigInt(payloadObj.installation.id) },
    });
    expect(inst).not.toBeNull();
    expect(inst!.status).toBe("ACTIVE");
    createdInstIds.push(inst!.id);

    // Verify repository in PostgreSQL
    const repo = await prisma.repository.findUnique({
      where: { githubRepoId: BigInt(payloadObj.repository.id) },
    });
    expect(repo).not.toBeNull();
    expect(repo!.enabled).toBe(true);
    expect(repo!.installationId).toBe(inst!.id);
    createdRepoIds.push(repo!.id);

    // Verify review run in PostgreSQL
    const run = await prisma.reviewRun.findUnique({
      where: { id: reviewRunId },
    });
    expect(run).not.toBeNull();
    expect(run!.repositoryId).toBe(repo!.id);
    expect(run!.prNumber).toBe(42);
    expect(run!.headSha).toBe(payloadObj.pull_request.head.sha);
    expect(run!.baseSha).toBe(payloadObj.pull_request.base.sha);
    expect(run!.status).toBe("QUEUED");
  });

  it("rejects invalid signature with 401 and writes nothing to the database", async () => {
    const payloadObj = makePayload();
    const rawBody = JSON.stringify(payloadObj);
    const badSignature =
      "sha256=0000000000000000000000000000000000000000000000000000000000000000";
    const deliveryId = `del-int-invalid-sig-${Date.now()}`;

    const res = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("x-hub-signature-256", badSignature)
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", deliveryId)
      .send(rawBody);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid webhook signature");

    // Database must have no record of this delivery or repo
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { deliveryId },
    });
    expect(delivery).toBeNull();

    const repo = await prisma.repository.findUnique({
      where: { githubRepoId: BigInt(payloadObj.repository.id) },
    });
    expect(repo).toBeNull();
  });

  it("handles duplicate delivery by returning 200 without creating duplicate review runs", async () => {
    const payloadObj = makePayload();
    const rawBody = JSON.stringify(payloadObj);
    const signature = sign(rawBody);
    const deliveryId = `del-int-replay-${Date.now()}`;
    createdDeliveryIds.push(deliveryId);

    // First request -> 202 Queued
    const res1 = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("x-hub-signature-256", signature)
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", deliveryId)
      .send(rawBody);

    expect(res1.status).toBe(202);
    const reviewRunId = res1.body.runId as string;
    if (reviewRunId) createdReviewRunIds.push(reviewRunId);

    const inst = await prisma.installation.findUnique({
      where: { githubInstallationId: BigInt(payloadObj.installation.id) },
    });
    if (inst) createdInstIds.push(inst.id);

    const repo = await prisma.repository.findUnique({
      where: { githubRepoId: BigInt(payloadObj.repository.id) },
    });
    if (repo) createdRepoIds.push(repo.id);

    // Second request with identical deliveryId -> 200 Duplicate
    const res2 = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("x-hub-signature-256", signature)
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", deliveryId)
      .send(rawBody);

    expect(res2.status).toBe(200);
    expect(res2.body.duplicate).toBe(true);

    // Check count of review runs for this repo
    const runCount = await prisma.reviewRun.count({
      where: {
        repositoryId: repo!.id,
        prNumber: 42,
      },
    });
    expect(runCount).toBe(1);
  });

  it("recovers stranded RECEIVED delivery on redelivery and creates review run", async () => {
    const payloadObj = makePayload();
    const rawBody = JSON.stringify(payloadObj);
    const signature = sign(rawBody);
    const deliveryId = `del-int-stranded-${Date.now()}`;
    createdDeliveryIds.push(deliveryId);

    // Pre-insert stranded delivery record (e.g. API crashed after recording delivery)
    await prisma.webhookDelivery.create({
      data: {
        deliveryId,
        event: "pull_request",
        action: "opened",
        status: "RECEIVED",
        attemptCount: 1,
      },
    });

    // Redelivery arrives from GitHub
    const res = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("x-hub-signature-256", signature)
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", deliveryId)
      .send(rawBody);

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("queued");
    const reviewRunId = res.body.runId as string;
    if (reviewRunId) createdReviewRunIds.push(reviewRunId);

    const inst = await prisma.installation.findUnique({
      where: { githubInstallationId: BigInt(payloadObj.installation.id) },
    });
    if (inst) createdInstIds.push(inst.id);

    const repo = await prisma.repository.findUnique({
      where: { githubRepoId: BigInt(payloadObj.repository.id) },
    });
    if (repo) createdRepoIds.push(repo.id);

    // Delivery status is RECEIVED and attemptCount incremented to 2
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { deliveryId },
    });
    expect(delivery!.status).toBe("RECEIVED");
    expect(delivery!.attemptCount).toBe(2);
    expect(delivery!.reviewRunId).toBe(reviewRunId);
  });

  it("transitions exhausted delivery (attemptCount >= 4) to FAILED with 400", async () => {
    const payloadObj = makePayload();
    const rawBody = JSON.stringify(payloadObj);
    const signature = sign(rawBody);
    const deliveryId = `del-int-exhausted-${Date.now()}`;
    createdDeliveryIds.push(deliveryId);

    // Pre-insert delivery at max attempts threshold (4)
    await prisma.webhookDelivery.create({
      data: {
        deliveryId,
        event: "pull_request",
        action: "opened",
        status: "RECEIVED",
        attemptCount: 4,
      },
    });

    // Redelivery arrives
    const res = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("x-hub-signature-256", signature)
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", deliveryId)
      .send(rawBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Delivery has exceeded maximum processing attempts",
    );

    // In DB, status is now FAILED
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { deliveryId },
    });
    expect(delivery!.status).toBe("FAILED");
    expect(delivery!.error).toBe(
      "Delivery has exceeded maximum processing attempts",
    );

    // Subsequent redelivery returns 200 duplicate
    const resRepeat = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("x-hub-signature-256", signature)
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", deliveryId)
      .send(rawBody);

    expect(resRepeat.status).toBe(200);
    expect(resRepeat.body.duplicate).toBe(true);
  });
});
