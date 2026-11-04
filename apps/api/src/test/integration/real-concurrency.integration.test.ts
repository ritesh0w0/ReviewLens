import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import {
  getTestPrismaClient,
  disconnectTestPrismaClient,
  cleanUpTestRecords,
} from "./test-db-client.js";

const testSecret = "integration-webhook-secret-concurrency";

function sign(body: string, secret: string = testSecret): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("Real PostgreSQL: Concurrency & Race Conditions", () => {
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

  function makePayload(
    repoId: number,
    instId: number,
    headSha: string,
    baseSha: string,
  ) {
    return {
      action: "opened",
      number: 55,
      pull_request: {
        number: 55,
        draft: false,
        head: {
          sha: headSha,
          ref: "concurrency-feature",
        },
        base: {
          sha: baseSha,
          ref: "main",
        },
        user: {
          login: "concurrent-user",
          type: "User",
        },
      },
      repository: {
        id: repoId,
        full_name: `test-org/concurrency-repo-${repoId}`,
        default_branch: "main",
        owner: {
          login: "test-org",
        },
      },
      installation: {
        id: instId,
        account: {
          login: "test-org",
          type: "Organization",
        },
      },
    };
  }

  it("handles 5 concurrent requests for same PR revision: exactly 1 ReviewRun created, 1 HTTP 202, 4 HTTP 200", async () => {
    const uniqueSuffix = Math.floor(Math.random() * 1000000);
    const repoId = 880000 + uniqueSuffix;
    const instId = 990000 + uniqueSuffix;
    const headSha = `head-concurrent-${uniqueSuffix}`;
    const baseSha = `base-concurrent-${uniqueSuffix}`;

    const payloadObj = makePayload(repoId, instId, headSha, baseSha);
    const rawBody = JSON.stringify(payloadObj);
    const signature = sign(rawBody);

    const deliveryIds = Array.from(
      { length: 5 },
      (_, i) => `conc-del-${uniqueSuffix}-${i}`,
    );
    createdDeliveryIds.push(...deliveryIds);

    // Fire 5 requests concurrently using Promise.all
    const responses = await Promise.all(
      deliveryIds.map((delId) =>
        request(app)
          .post("/webhooks/github")
          .set("Content-Type", "application/json")
          .set("x-hub-signature-256", signature)
          .set("x-github-event", "pull_request")
          .set("x-github-delivery", delId)
          .send(rawBody),
      ),
    );

    // Collect status codes
    const statusCodes = responses.map((r) => r.status);
    const count202 = statusCodes.filter((s) => s === 202).length;
    const count200 = statusCodes.filter((s) => s === 200).length;

    expect(count202).toBe(1);
    expect(count200).toBe(4);

    // Check bodies: exactly 1 queued, 4 duplicates
    const queuedResponses = responses.filter((r) => r.body.status === "queued");
    const duplicateResponses = responses.filter(
      (r) => r.body.duplicate === true,
    );
    expect(queuedResponses.length).toBe(1);
    expect(duplicateResponses.length).toBe(4);

    const winningRunId = queuedResponses[0]!.body.runId as string;
    createdReviewRunIds.push(winningRunId);

    // Track repo and inst IDs for cleanup
    const inst = await prisma.installation.findUnique({
      where: { githubInstallationId: BigInt(instId) },
    });
    if (inst) createdInstIds.push(inst.id);

    const repo = await prisma.repository.findUnique({
      where: { githubRepoId: BigInt(repoId) },
    });
    if (repo) createdRepoIds.push(repo.id);

    // Verify exactly 1 ReviewRun in PostgreSQL for this PR revision
    const runs = await prisma.reviewRun.findMany({
      where: {
        repositoryId: repo!.id,
        prNumber: 55,
        headSha,
        baseSha,
      },
    });
    expect(runs.length).toBe(1);
    expect(runs[0]!.id).toBe(winningRunId);

    // Verify all 5 deliveries were recorded in PostgreSQL
    const deliveries = await prisma.webhookDelivery.findMany({
      where: {
        deliveryId: { in: deliveryIds },
      },
    });
    expect(deliveries.length).toBe(5);
  });

  it("handles 3 concurrent requests with the identical deliveryId: exactly 1 WebhookDelivery record created", async () => {
    const uniqueSuffix = Math.floor(Math.random() * 1000000);
    const repoId = 881000 + uniqueSuffix;
    const instId = 991000 + uniqueSuffix;
    const headSha = `head-samedel-${uniqueSuffix}`;
    const baseSha = `base-samedel-${uniqueSuffix}`;

    const payloadObj = makePayload(repoId, instId, headSha, baseSha);
    const rawBody = JSON.stringify(payloadObj);
    const signature = sign(rawBody);

    const sharedDeliveryId = `shared-del-${uniqueSuffix}`;
    createdDeliveryIds.push(sharedDeliveryId);

    // Fire 3 requests concurrently with the exact same deliveryId
    const responses = await Promise.all([
      request(app)
        .post("/webhooks/github")
        .set("Content-Type", "application/json")
        .set("x-hub-signature-256", signature)
        .set("x-github-event", "pull_request")
        .set("x-github-delivery", sharedDeliveryId)
        .send(rawBody),
      request(app)
        .post("/webhooks/github")
        .set("Content-Type", "application/json")
        .set("x-hub-signature-256", signature)
        .set("x-github-event", "pull_request")
        .set("x-github-delivery", sharedDeliveryId)
        .send(rawBody),
      request(app)
        .post("/webhooks/github")
        .set("Content-Type", "application/json")
        .set("x-hub-signature-256", signature)
        .set("x-github-event", "pull_request")
        .set("x-github-delivery", sharedDeliveryId)
        .send(rawBody),
    ]);

    // Track entities for cleanup
    const inst = await prisma.installation.findUnique({
      where: { githubInstallationId: BigInt(instId) },
    });
    if (inst) createdInstIds.push(inst.id);

    const repo = await prisma.repository.findUnique({
      where: { githubRepoId: BigInt(repoId) },
    });
    if (repo) createdRepoIds.push(repo.id);

    for (const r of responses) {
      if (r.body?.runId) {
        createdReviewRunIds.push(r.body.runId);
      }
    }

    // Every response must be either 202 (queued) or 200 (duplicate), never 500/503
    for (const res of responses) {
      expect([200, 202]).toContain(res.status);
    }

    // Exactly 1 WebhookDelivery record exists in the database
    const deliveryRecords = await prisma.webhookDelivery.findMany({
      where: { deliveryId: sharedDeliveryId },
    });
    expect(deliveryRecords.length).toBe(1);

    // Exactly 1 ReviewRun exists in the database
    const runRecords = await prisma.reviewRun.findMany({
      where: {
        repositoryId: repo!.id,
        prNumber: 55,
        headSha,
        baseSha,
      },
    });
    expect(runRecords.length).toBe(1);
  });
});
