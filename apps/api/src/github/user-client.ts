import { Octokit } from "@octokit/rest";

export interface GitHubUserIdentity {
  id: number;
  login: string;
  avatar_url: string | null;
}

export interface GitHubUserInstallation {
  id: number;
  account: {
    login: string;
    type: string;
    avatar_url: string | null;
  };
  repository_selection?: string;
}

export interface GitHubUserRepository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
  };
  private: boolean;
  permissions?: {
    admin?: boolean;
    push?: boolean;
    pull?: boolean;
  };
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

export interface GitHubUserClient {
  exchangeCodeForToken(params: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<OAuthTokenResponse>;

  getUserIdentity(accessToken: string): Promise<GitHubUserIdentity>;

  getUserInstallations(accessToken: string): Promise<GitHubUserInstallation[]>;

  getUserInstallationRepositories(
    accessToken: string,
    installationId: number,
  ): Promise<GitHubUserRepository[]>;
}

/**
 * Real production GitHubUserClient using Octokit and standard fetch.
 */
export class OctokitGitHubUserClient implements GitHubUserClient {
  async exchangeCodeForToken(params: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<OAuthTokenResponse> {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        code: params.code,
        redirect_uri: params.redirectUri,
        code_verifier: params.codeVerifier,
      }),
    });

    if (!res.ok) {
      throw new Error(
        `GitHub OAuth token exchange failed with HTTP ${res.status}`,
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    if (data.error) {
      throw new Error(
        `GitHub OAuth error: ${data.error} (${data.error_description ?? "no description"})`,
      );
    }

    return {
      access_token: String(data.access_token),
      token_type: String(data.token_type ?? "bearer"),
      scope: data.scope ? String(data.scope) : undefined,
      expires_in:
        typeof data.expires_in === "number" ? data.expires_in : undefined,
      refresh_token: data.refresh_token
        ? String(data.refresh_token)
        : undefined,
    };
  }

  async getUserIdentity(accessToken: string): Promise<GitHubUserIdentity> {
    const octokit = new Octokit({ auth: accessToken });
    const res = await octokit.rest.users.getAuthenticated();
    return {
      id: res.data.id,
      login: res.data.login,
      avatar_url: res.data.avatar_url,
    };
  }

  async getUserInstallations(
    accessToken: string,
  ): Promise<GitHubUserInstallation[]> {
    const octokit = new Octokit({ auth: accessToken });
    const installations = await octokit.paginate(
      octokit.rest.apps.listInstallationsForAuthenticatedUser,
      { per_page: 100 },
    );

    return installations.map((inst) => ({
      id: inst.id,
      account: {
        login: (inst.account as { login?: string })?.login ?? "unknown",
        type: (inst.account as { type?: string })?.type ?? "User",
        avatar_url:
          (inst.account as { avatar_url?: string })?.avatar_url ?? null,
      },
      repository_selection: inst.repository_selection,
    }));
  }

  async getUserInstallationRepositories(
    accessToken: string,
    installationId: number,
  ): Promise<GitHubUserRepository[]> {
    const octokit = new Octokit({ auth: accessToken });
    const repos = await octokit.paginate(
      octokit.rest.apps.listInstallationReposForAuthenticatedUser,
      {
        installation_id: installationId,
        per_page: 100,
      },
    );

    return repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      owner: {
        login: repo.owner.login,
      },
      private: repo.private,
      permissions: repo.permissions,
    }));
  }
}

/**
 * Deterministic In-Memory Fake for automated testing without live GitHub network access.
 */
export class FakeGitHubUserClient implements GitHubUserClient {
  public tokenResponses: Map<string, OAuthTokenResponse> = new Map();
  public users: Map<string, GitHubUserIdentity> = new Map();
  public installations: Map<string, GitHubUserInstallation[]> = new Map();
  public repositories: Map<string, GitHubUserRepository[]> = new Map(); // key: `${token}:${installationId}`

  public exchangeCalls: Array<{ code: string; codeVerifier: string }> = [];

  async exchangeCodeForToken(params: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<OAuthTokenResponse> {
    this.exchangeCalls.push({
      code: params.code,
      codeVerifier: params.codeVerifier,
    });

    const response = this.tokenResponses.get(params.code);
    if (!response) {
      throw new Error(`Invalid or expired code: ${params.code}`);
    }
    return response;
  }

  async getUserIdentity(accessToken: string): Promise<GitHubUserIdentity> {
    const user = this.users.get(accessToken);
    if (!user) {
      throw new Error(`Unauthorized user token: ${accessToken}`);
    }
    return user;
  }

  async getUserInstallations(
    accessToken: string,
  ): Promise<GitHubUserInstallation[]> {
    const insts = this.installations.get(accessToken);
    if (!insts) {
      return [];
    }
    return insts;
  }

  async getUserInstallationRepositories(
    accessToken: string,
    installationId: number,
  ): Promise<GitHubUserRepository[]> {
    const key = `${accessToken}:${installationId}`;
    return this.repositories.get(key) ?? [];
  }
}
