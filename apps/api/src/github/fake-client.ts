import type {
  GitHubPullRequestClient,
  GitHubPullRequestInfo,
  GitHubReviewItem,
  GitHubChangedFileItem,
  CreateReviewInput,
  AuthenticatedAppInfo,
} from "./pull-request-client.js";

export interface FakeGitHubState {
  prInfo: GitHubPullRequestInfo;
  reviews: GitHubReviewItem[];
  files?: GitHubChangedFileItem[];
  filePages?: Record<number, GitHubChangedFileItem[]>;
  contents?: Record<string, string>; // keyed by `${path}@${ref}` or `${path}`
  shouldFailWith?: Error;
  shouldFailFilesWith?: Error;
  shouldFailContentWith?: Error;
  shouldFailCreateReviewWith?: Error;
  shouldFailListReviewsWith?: Error;
  appInfo?: AuthenticatedAppInfo;
  onGetPullRequest?: () => GitHubPullRequestInfo;
}

export class FakeGitHubPullRequestClient implements GitHubPullRequestClient {
  public reviewsCreated: Array<{
    owner: string;
    repo: string;
    pullNumber: number;
    commitSha: string;
    body: string;
  }> = [];

  public batchedReviewsCreated: Array<{
    owner: string;
    repo: string;
    pullNumber: number;
    input: CreateReviewInput;
  }> = [];

  public filesCalls: Array<{ page?: number; perPage?: number }> = [];
  public contentsCalls: Array<{ path: string; ref: string }> = [];
  public prCallsCount = 0;
  public listReviewsCallsCount = 0;

  constructor(public state: FakeGitHubState) {}

  async getPullRequest(
    _owner: string,
    _repo: string,
    _pullNumber: number,
    options?: { signal?: AbortSignal },
  ): Promise<GitHubPullRequestInfo> {
    if (options?.signal?.aborted) {
      throw new Error("Aborted");
    }
    if (this.state.shouldFailWith) {
      throw this.state.shouldFailWith;
    }
    this.prCallsCount++;
    if (this.state.onGetPullRequest) {
      return this.state.onGetPullRequest();
    }
    return this.state.prInfo;
  }

  async getPullRequestFiles(
    _owner: string,
    _repo: string,
    _pullNumber: number,
    options?: { signal?: AbortSignal; page?: number; perPage?: number },
  ): Promise<GitHubChangedFileItem[]> {
    if (options?.signal?.aborted) {
      throw new Error("Aborted");
    }
    if (this.state.shouldFailFilesWith) {
      throw this.state.shouldFailFilesWith;
    }
    if (this.state.shouldFailWith) {
      throw this.state.shouldFailWith;
    }

    const page = options?.page ?? 1;
    const perPage = options?.perPage ?? 100;
    this.filesCalls.push({ page, perPage });

    if (this.state.filePages && this.state.filePages[page]) {
      return this.state.filePages[page];
    }

    const allFiles = this.state.files ?? [];
    const startIndex = (page - 1) * perPage;
    return allFiles.slice(startIndex, startIndex + perPage);
  }

  async getFileContent(
    _owner: string,
    _repo: string,
    path: string,
    ref: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | null> {
    if (options?.signal?.aborted) {
      throw new Error("Aborted");
    }
    if (this.state.shouldFailContentWith) {
      throw this.state.shouldFailContentWith;
    }
    if (this.state.shouldFailWith) {
      throw this.state.shouldFailWith;
    }

    this.contentsCalls.push({ path, ref });

    const contents = this.state.contents ?? {};
    // Check specific ref first, then path
    if (contents[`${path}@${ref}`] !== undefined) {
      return contents[`${path}@${ref}`];
    }
    if (contents[path] !== undefined) {
      return contents[path];
    }

    return null; // 404
  }

  async listReviews(
    _owner: string,
    _repo: string,
    _pullNumber: number,
    options?: { signal?: AbortSignal },
  ): Promise<GitHubReviewItem[]> {
    if (options?.signal?.aborted) {
      throw new Error("Aborted");
    }
    if (this.state.shouldFailListReviewsWith) {
      throw this.state.shouldFailListReviewsWith;
    }
    if (this.state.shouldFailWith) {
      throw this.state.shouldFailWith;
    }
    this.listReviewsCallsCount++;
    return this.state.reviews;
  }

  async createCommentReview(
    owner: string,
    repo: string,
    pullNumber: number,
    commitSha: string,
    body: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ id: number }> {
    if (options?.signal?.aborted) {
      throw new Error("Aborted");
    }
    if (this.state.shouldFailCreateReviewWith) {
      throw this.state.shouldFailCreateReviewWith;
    }
    if (this.state.shouldFailWith) {
      throw this.state.shouldFailWith;
    }

    const id = Math.floor(Math.random() * 900000) + 100000;
    const app = await this.getAuthenticatedApp();
    const review: GitHubReviewItem = {
      id,
      body,
      state: "COMMENTED",
      commit_id: commitSha,
      user: {
        login: app.login ?? "reviewlens[bot]",
        type: "Bot",
        id: app.id,
      },
    };
    this.state.reviews.push(review);
    this.reviewsCreated.push({ owner, repo, pullNumber, commitSha, body });
    return { id };
  }

  async createReview(
    owner: string,
    repo: string,
    pullNumber: number,
    input: CreateReviewInput,
    options?: { signal?: AbortSignal },
  ): Promise<{ id: number }> {
    if (options?.signal?.aborted) {
      throw new Error("Aborted");
    }
    if (this.state.shouldFailCreateReviewWith) {
      throw this.state.shouldFailCreateReviewWith;
    }
    if (this.state.shouldFailWith) {
      throw this.state.shouldFailWith;
    }

    const id = Math.floor(Math.random() * 900000) + 100000;
    const app = await this.getAuthenticatedApp();
    const review: GitHubReviewItem = {
      id,
      body: input.body,
      state: "COMMENTED",
      commit_id: input.commitSha,
      user: {
        login: app.login ?? "reviewlens[bot]",
        type: "Bot",
        id: app.id,
      },
    };
    this.state.reviews.push(review);
    this.reviewsCreated.push({
      owner,
      repo,
      pullNumber,
      commitSha: input.commitSha,
      body: input.body,
    });
    this.batchedReviewsCreated.push({
      owner,
      repo,
      pullNumber,
      input,
    });
    return { id };
  }

  async getAuthenticatedApp(options?: {
    signal?: AbortSignal;
  }): Promise<AuthenticatedAppInfo> {
    if (options?.signal?.aborted) {
      throw new Error("Aborted");
    }
    return (
      this.state.appInfo ?? {
        id: 12345,
        slug: "reviewlens",
        login: "reviewlens[bot]",
      }
    );
  }
}
