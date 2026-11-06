import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import type {
  GitHubPullRequestClient,
  GitHubPullRequestInfo,
  GitHubReviewItem,
  GitHubChangedFileItem,
  CreateReviewInput,
  AuthenticatedAppInfo,
} from "./pull-request-client.js";

export interface GitHubAppAuthConfig {
  appId: string | number;
  privateKey: string;
  installationId: number | bigint;
  repositoryGithubId?: number | bigint;
  testStatelessHeader?: "enabled" | "disabled";
}

export class OctokitPullRequestClient implements GitHubPullRequestClient {
  private octokitPromise?: Promise<Octokit>;

  constructor(private readonly config: GitHubAppAuthConfig) {}

  private async getOctokit(signal?: AbortSignal): Promise<Octokit> {
    if (!this.octokitPromise) {
      this.octokitPromise = (async () => {
        const auth = createAppAuth({
          appId: this.config.appId,
          privateKey: this.config.privateKey,
        });

        const repoIds = this.config.repositoryGithubId
          ? [Number(this.config.repositoryGithubId)]
          : undefined;

        // Exchange JWT for scoped installation access token
        const installationAuth = await auth({
          type: "installation",
          installationId: Number(this.config.installationId),
          repositoryIds: repoIds,
          permissions: {
            pull_requests: "write",
            metadata: "read",
            contents: "read",
          },
        });

        // Opaque token: do not inspect length or decode internals
        const headers: Record<string, string> = {};
        if (this.config.testStatelessHeader) {
          headers["X-GitHub-Stateless-S2S-Token"] =
            this.config.testStatelessHeader;
        }

        return new Octokit({
          auth: installationAuth.token,
          request: {
            headers,
          },
        });
      })();
    }

    const client = await this.octokitPromise;
    if (signal) {
      // Return scoped client with caller abort signal if supplied
      return client;
    }
    return client;
  }

  async getPullRequest(
    owner: string,
    repo: string,
    pullNumber: number,
    options?: { signal?: AbortSignal },
  ): Promise<GitHubPullRequestInfo> {
    const octokit = await this.getOctokit(options?.signal);

    const res = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      request: options?.signal ? { signal: options.signal } : undefined,
    });

    const data = res.data;
    const state = data.state === "open" ? "open" : "closed";

    return {
      state,
      headSha: data.head.sha,
      baseSha: data.base.sha,
      prNumber: data.number,
      isDraft: data.draft ?? false,
      baseRef: data.base.ref,
      headRef: data.head.ref,
      changedFilesCount: data.changed_files ?? 0,
      merged: data.merged ?? false,
    };
  }

  async getPullRequestFiles(
    owner: string,
    repo: string,
    pullNumber: number,
    options?: { signal?: AbortSignal; page?: number; perPage?: number },
  ): Promise<GitHubChangedFileItem[]> {
    const octokit = await this.getOctokit(options?.signal);

    const res = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: options?.perPage ?? 100,
      page: options?.page ?? 1,
      request: options?.signal ? { signal: options.signal } : undefined,
    });

    return res.data.map((f) => ({
      filename: f.filename,
      previous_filename: f.previous_filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      sha: f.sha,
      patch: f.patch,
    }));
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | null> {
    const octokit = await this.getOctokit(options?.signal);

    try {
      const res = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref,
        request: options?.signal ? { signal: options.signal } : undefined,
      });

      const data = res.data;
      if (!data || Array.isArray(data) || !("content" in data)) {
        return null;
      }

      if (data.encoding === "base64" && data.content) {
        return Buffer.from(data.content, "base64").toString("utf8");
      }

      return null;
    } catch (err: unknown) {
      const status = (err as unknown as { status?: number }).status;
      if (status === 404) {
        return null;
      }
      throw err;
    }
  }

  async listReviews(
    owner: string,
    repo: string,
    pullNumber: number,
    options?: { signal?: AbortSignal },
  ): Promise<GitHubReviewItem[]> {
    const octokit = await this.getOctokit(options?.signal);

    const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
      request: options?.signal ? { signal: options.signal } : undefined,
    });

    return reviews.map((r) => ({
      id: r.id,
      body: r.body ?? "",
      state: r.state,
      commit_id: r.commit_id ?? undefined,
      user: r.user
        ? {
            login: r.user.login,
            type: r.user.type,
            id: r.user.id,
          }
        : undefined,
      submitted_at: r.submitted_at ?? undefined,
    }));
  }

  async createCommentReview(
    owner: string,
    repo: string,
    pullNumber: number,
    commitSha: string,
    body: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ id: number }> {
    return this.createReview(
      owner,
      repo,
      pullNumber,
      {
        commitSha,
        body,
        event: "COMMENT",
      },
      options,
    );
  }

  async createReview(
    owner: string,
    repo: string,
    pullNumber: number,
    input: CreateReviewInput,
    options?: { signal?: AbortSignal },
  ): Promise<{ id: number }> {
    const octokit = await this.getOctokit(options?.signal);

    const comments = input.comments?.map((c) => ({
      path: c.path,
      line: c.line,
      side: c.side ?? "RIGHT",
      body: c.body,
    }));

    const res = await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: input.commitSha,
      body: input.body,
      event: "COMMENT",
      comments: comments && comments.length > 0 ? comments : undefined,
      request: options?.signal ? { signal: options.signal } : undefined,
    });

    return { id: res.data.id };
  }

  async getAuthenticatedApp(options?: {
    signal?: AbortSignal;
  }): Promise<AuthenticatedAppInfo> {
    const octokit = await this.getOctokit(options?.signal);
    try {
      const res = await octokit.rest.apps.getAuthenticated({
        request: options?.signal ? { signal: options.signal } : undefined,
      });
      if (res && res.data) {
        return {
          id: res.data.id,
          slug: res.data.slug ?? "reviewlens",
          login: `${res.data.slug ?? "reviewlens"}[bot]`,
        };
      }
      return {
        id: Number(this.config.appId),
        slug: "reviewlens",
        login: "reviewlens[bot]",
      };
    } catch {
      return {
        id: Number(this.config.appId),
        slug: "reviewlens",
        login: "reviewlens[bot]",
      };
    }
  }
}
