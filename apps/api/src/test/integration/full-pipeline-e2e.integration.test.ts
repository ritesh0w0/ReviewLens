import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  getTestPrismaClient,
  disconnectTestPrismaClient,
  cleanUpTestRecords,
} from "./test-db-client.js";
import {
  createPgBoss,
  startPgBoss,
  stopPgBoss,
  PgBoss,
} from "../../queue/client.js";
import { ensureQueues } from "../../queue/setup-queues.js";
import { createApp } from "../../app.js";
import { DeliveryStatus, ReviewStatus } from "../../generated/prisma/client.js";
import { FakeGitHubPullRequestClient } from "../../github/fake-client.js";
import { registerReviewWorker } from "../../workers/review-worker.js";
import { formatReviewMarker } from "../../github/pull-request-client.js";

const testSecret = "integration-webhook-secret-e2e";

function sign(body: string, secret: string = testSecret): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("Real PostgreSQL & pg-boss: Full Pipeline E2E (Step 7)", () => {
  const prisma = getTestPrismaClient();
  const testDbUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;

  let boss: PgBoss;
  let app: ReturnType<typeof createApp>;
  let fakeGithub: FakeGitHubPullRequestClient;

  const createdDeliveryIds: string[] = [];
  const createdReviewRunIds: string[] = [];
  const createdRepoIds: string[] = [];
  const createdInstIds: string[] = [];

  const defaultHeadSha = "4444444444444444444444444444444444444444";
  const defaultBaseSha = "5555555555555555555555555555555555555555";
  const defaultPrNumber = 404;

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;

    boss = createPgBoss({
      connectionString: testDbUrl,
      schema: "pgboss",
      max: 4,
      application_name: "test-boss-e2e",
    });

    await startPgBoss(boss);
    await ensureQueues(boss);

    fakeGithub = new FakeGitHubPullRequestClient({
      prInfo: {
        state: "open",
        headSha: defaultHeadSha,
        baseSha: defaultBaseSha,
        prNumber: defaultPrNumber,
      },
      reviews: [],
    });

    // Register review worker consuming real pg-boss jobs
    await registerReviewWorker(boss, prisma, {
      githubClient: fakeGithub,
      concurrency: 1,
      publishReview: true,
    });

    app = createApp({
      webhookSecret: testSecret,
      prisma,
      boss,
    });
  });

  afterAll(async () => {
    if (boss) {
      await stopPgBoss(boss);
    }
    await cleanUpTestRecords(prisma, {
      deliveryIds: createdDeliveryIds,
      reviewRunIds: createdReviewRunIds,
      repositoryIds: createdRepoIds,
      installationIds: createdInstIds,
    });
    await disconnectTestPrismaClient();
  });

  function createPRPayload(overrides: Record<string, unknown> = {}) {
    const unique = Math.floor(Math.random() * 900000) + 100000;
    return {
      action: "opened",
      number: defaultPrNumber,
      pull_request: {
        number: defaultPrNumber,
        draft: false,
        head: {
          sha: defaultHeadSha,
          ref: "e2e-feature",
        },
        base: {
          sha: defaultBaseSha,
          ref: "main",
        },
        user: {
          login: `author-${unique}`,
          type: "User",
        },
      },
      repository: {
        id: unique,
        full_name: `e2e-org-${unique}/e2e-repo-${unique}`,
        default_branch: "main",
      },
      installation: {
        id: unique + 1,
        account: {
          login: `e2e-org-${unique}`,
          type: "Organization",
        },
      },
      ...overrides,
    };
  }

  it("executes the complete asynchronous review pipeline end-to-end", async () => {
    const payload = createPRPayload();
    const body = JSON.stringify(payload);
    const deliveryId1 = `del-e2e-1-${Date.now()}`;
    createdDeliveryIds.push(deliveryId1);

    // 1. Submit signed webhook to API endpoint
    const res = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", deliveryId1)
      .send(body);

    expect(res.status).toBe(202);
    expect(res.body.received).toBe(true);
    expect(res.body.status).toBe("queued");
    expect(res.body.runId).toBeDefined();

    const runId = res.body.runId;
    createdReviewRunIds.push(runId);

    // 2. Poll until the asynchronous worker processes the job into SUCCEEDED state
    let updatedRun = await prisma.reviewRun.findUnique({
      where: { id: runId },
    });
    for (
      let i = 0;
      i < 50 && updatedRun?.status !== ReviewStatus.SUCCEEDED;
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      updatedRun = await prisma.reviewRun.findUnique({
        where: { id: runId },
      });
    }

    // 3. Verify final database state
    expect(updatedRun?.status).toBe(ReviewStatus.SUCCEEDED);
    expect(updatedRun?.githubReviewId).not.toBeNull();
    expect(updatedRun?.claimToken).not.toBeNull();
    expect(updatedRun?.finishedAt).not.toBeNull();

    // 4. Verify delivery status is ENQUEUED
    const del1 = await prisma.webhookDelivery.findUnique({
      where: { deliveryId: deliveryId1 },
    });
    expect(del1?.status).toBe(DeliveryStatus.ENQUEUED);
    expect(del1?.reviewRunId).toBe(runId);

    // 5. Verify exactly 1 advisory review comment was published
    expect(fakeGithub.reviewsCreated.length).toBe(1);
    expect(fakeGithub.reviewsCreated[0].body).toContain(
      formatReviewMarker(runId),
    );

    // 6. Test duplicate delivery ID: does not publish duplicate review
    const resDup = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", deliveryId1)
      .send(body);

    expect(resDup.status).toBe(200);
    expect(resDup.body.duplicate).toBe(true);
    expect(fakeGithub.reviewsCreated.length).toBe(1); // Still 1

    // 7. Test redelivery with a new deliveryId for the same commit: links run and does not duplicate
    const deliveryId2 = `del-e2e-2-${Date.now()}`;
    createdDeliveryIds.push(deliveryId2);

    const resRev = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", deliveryId2)
      .send(body);

    expect(resRev.status).toBe(200);
    expect(resRev.body.duplicate).toBe(true);

    const del2 = await prisma.webhookDelivery.findUnique({
      where: { deliveryId: deliveryId2 },
    });
    expect(del2?.status).toBe(DeliveryStatus.ENQUEUED);
    expect(del2?.reviewRunId).toBe(runId);
    expect(fakeGithub.reviewsCreated.length).toBe(1); // Still 1
  });
});
