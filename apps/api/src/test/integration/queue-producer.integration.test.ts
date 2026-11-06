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
import { QUEUE_REVIEW_PR } from "../../queue/queues.js";
import { createApp } from "../../app.js";
import {
  DeliveryStatus,
  InstallationStatus,
  ReviewStatus,
} from "../../generated/prisma/client.js";

const testSecret = "integration-webhook-secret-step3";

function sign(body: string, secret: string = testSecret): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("Real PostgreSQL & pg-boss: Queue Producer & Job Contract (Step 3)", () => {
  const prisma = getTestPrismaClient();
  const testDbUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;

  let boss: PgBoss;
  let app: ReturnType<typeof createApp>;

  const createdDeliveryIds: string[] = [];
  const createdReviewRunIds: string[] = [];
  const createdRepoIds: string[] = [];
  const createdInstIds: string[] = [];

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;

    boss = createPgBoss({
      connectionString: testDbUrl,
      schema: "pgboss",
      max: 4,
      application_name: "test-boss-step3",
    });

    await startPgBoss(boss);
    await ensureQueues(boss);

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
      number: 101,
      pull_request: {
        number: 101,
        draft: false,
        head: {
          sha: "a1b2c3d4e5f678901234567890abcdef12345678",
          ref: "feature-branch",
        },
        base: {
          sha: "f1e2d3c4b5a678901234567890abcdef12345678",
          ref: "main",
        },
        user: {
          login: `author-${unique}`,
          type: "User",
        },
      },
      repository: {
        id: unique,
        full_name: `org-${unique}/repo-${unique}`,
        default_branch: "main",
      },
      installation: {
        id: unique + 1,
        account: {
          login: `org-${unique}`,
          type: "Organization",
        },
      },
      ...overrides,
    };
  }

  it("atomically creates ReviewRun, inserts deterministic pg-boss job, and sets delivery ENQUEUED", async () => {
    const payload = createPRPayload();
    const body = JSON.stringify(payload);
    const deliveryId = `del-prod-${Date.now()}`;
    createdDeliveryIds.push(deliveryId);

    const res = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", deliveryId)
      .send(body);

    expect(res.status).toBe(202);
    expect(res.body.received).toBe(true);
    expect(res.body.status).toBe("queued");
    expect(res.body.runId).toBeDefined();

    const runId = res.body.runId;
    createdReviewRunIds.push(runId);

    // 1. Delivery is ENQUEUED and linked to run
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { deliveryId },
    });
    expect(delivery).not.toBeNull();
    expect(delivery?.status).toBe(DeliveryStatus.ENQUEUED);
    expect(delivery?.reviewRunId).toBe(runId);

    // 2. ReviewRun is QUEUED
    const run = await prisma.reviewRun.findUnique({
      where: { id: runId },
    });
    expect(run).not.toBeNull();
    expect(run?.status).toBe(ReviewStatus.QUEUED);

    // 3. Queue job exists with deterministic id = runId
    const jobs = await boss.findJobs(QUEUE_REVIEW_PR, { id: runId });
    expect(jobs.length).toBe(1);
    expect(jobs[0].id).toBe(runId);
    expect(jobs[0].data).toEqual({ schemaVersion: 1, runId });
  });

  it("handles duplicate delivery ID idempotently without creating duplicate jobs", async () => {
    const payload = createPRPayload();
    const body = JSON.stringify(payload);
    const deliveryId = `del-dup-id-${Date.now()}`;
    createdDeliveryIds.push(deliveryId);

    // First delivery -> 202
    const firstRes = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", deliveryId)
      .send(body);

    expect(firstRes.status).toBe(202);
    const runId = firstRes.body.runId;
    createdReviewRunIds.push(runId);

    // Second delivery with exact same deliveryId -> 200 duplicate
    const secondRes = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", deliveryId)
      .send(body);

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.duplicate).toBe(true);

    // Exactly 1 job exists
    const jobs = await boss.findJobs(QUEUE_REVIEW_PR, { id: runId });
    expect(jobs.length).toBe(1);
  });

  it("handles redelivery for the same PR commit revision with different deliveryId", async () => {
    const payload = createPRPayload();
    const body = JSON.stringify(payload);
    const deliveryId1 = `del-rev-1-${Date.now()}`;
    const deliveryId2 = `del-rev-2-${Date.now()}`;
    createdDeliveryIds.push(deliveryId1, deliveryId2);

    // First request -> 202
    const res1 = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", deliveryId1)
      .send(body);

    expect(res1.status).toBe(202);
    const runId = res1.body.runId;
    createdReviewRunIds.push(runId);

    // Second request with different deliveryId but identical PR revision -> 200 duplicate
    const res2 = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Event", "pull_request")
      .set("X-GitHub-Delivery", deliveryId2)
      .send(body);

    expect(res2.status).toBe(200);
    expect(res2.body.duplicate).toBe(true);

    // Second delivery is linked to the same ReviewRun and ENQUEUED
    const del2 = await prisma.webhookDelivery.findUnique({
      where: { deliveryId: deliveryId2 },
    });
    expect(del2?.reviewRunId).toBe(runId);
    expect(del2?.status).toBe(DeliveryStatus.ENQUEUED);

    // Exactly 1 job exists in queue
    const jobs = await boss.findJobs(QUEUE_REVIEW_PR, { id: runId });
    expect(jobs.length).toBe(1);
  });

  it("processes GitHub installation lifecycle events and updates repository states", async () => {
    const instGithubId = Math.floor(Math.random() * 900000) + 100000;
    const repoGithubId = Math.floor(Math.random() * 900000) + 200000;

    // 1. installation.created
    const createPayload = {
      action: "created",
      installation: {
        id: instGithubId,
        account: { login: `inst-org-${instGithubId}`, type: "Organization" },
      },
      repositories: [
        {
          id: repoGithubId,
          full_name: `inst-org-${instGithubId}/test-repo`,
          default_branch: "main",
        },
      ],
    };
    const body1 = JSON.stringify(createPayload);
    const del1 = `del-inst-create-${Date.now()}`;
    createdDeliveryIds.push(del1);

    const res1 = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body1))
      .set("X-GitHub-Event", "installation")
      .set("X-GitHub-Delivery", del1)
      .send(body1);

    expect(res1.status).toBe(200);
    expect(res1.body.ignored).toBe(true);

    const inst = await prisma.installation.findUnique({
      where: { githubInstallationId: BigInt(instGithubId) },
    });
    expect(inst).not.toBeNull();
    expect(inst?.status).toBe(InstallationStatus.ACTIVE);
    createdInstIds.push(inst!.id);

    const repo = await prisma.repository.findUnique({
      where: { githubRepoId: BigInt(repoGithubId) },
    });
    expect(repo).not.toBeNull();
    expect(repo?.enabled).toBe(true);
    createdRepoIds.push(repo!.id);

    // 2. installation.suspend
    const suspendPayload = {
      action: "suspend",
      installation: { id: instGithubId },
    };
    const body2 = JSON.stringify(suspendPayload);
    const del2 = `del-inst-suspend-${Date.now()}`;
    createdDeliveryIds.push(del2);

    await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body2))
      .set("X-GitHub-Event", "installation")
      .set("X-GitHub-Delivery", del2)
      .send(body2);

    const suspendedInst = await prisma.installation.findUnique({
      where: { githubInstallationId: BigInt(instGithubId) },
    });
    expect(suspendedInst?.status).toBe(InstallationStatus.SUSPENDED);

    // 3. installation.unsuspend
    const unsuspendPayload = {
      action: "unsuspend",
      installation: { id: instGithubId },
    };
    const body3 = JSON.stringify(unsuspendPayload);
    const del3 = `del-inst-unsuspend-${Date.now()}`;
    createdDeliveryIds.push(del3);

    await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body3))
      .set("X-GitHub-Event", "installation")
      .set("X-GitHub-Delivery", del3)
      .send(body3);

    const unsuspendedInst = await prisma.installation.findUnique({
      where: { githubInstallationId: BigInt(instGithubId) },
    });
    expect(unsuspendedInst?.status).toBe(InstallationStatus.ACTIVE);

    // 4. installation.deleted
    const deletedPayload = {
      action: "deleted",
      installation: { id: instGithubId },
    };
    const body4 = JSON.stringify(deletedPayload);
    const del4 = `del-inst-deleted-${Date.now()}`;
    createdDeliveryIds.push(del4);

    await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body4))
      .set("X-GitHub-Event", "installation")
      .set("X-GitHub-Delivery", del4)
      .send(body4);

    const deletedInst = await prisma.installation.findUnique({
      where: { githubInstallationId: BigInt(instGithubId) },
    });
    expect(deletedInst?.status).toBe(InstallationStatus.DELETED);

    const disabledRepo = await prisma.repository.findUnique({
      where: { githubRepoId: BigInt(repoGithubId) },
    });
    expect(disabledRepo?.enabled).toBe(false);
  });
});
