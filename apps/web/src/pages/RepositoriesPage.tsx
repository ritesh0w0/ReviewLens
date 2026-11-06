import { useState, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRepositories } from "../api/client.js";
import { StatusBadge } from "../components/StatusBadge.js";

interface RepositoriesPageProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function RepositoriesPage({
  currentPath,
  onNavigate,
}: RepositoriesPageProps) {
  // Parse query params from currentPath (e.g. "#/repositories?installationId=12345")
  const urlParts = currentPath.split("?");
  const searchParams = new URLSearchParams(urlParts[1] ?? "");
  const installationIdParam = searchParams.get("installationId") ?? undefined;

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"name" | "recent">("recent");
  const searchInputId = useId();
  const sortSelectId = useId();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [
      "repositories",
      { installationId: installationIdParam, search, page, sortBy },
    ],
    queryFn: () =>
      fetchRepositories({
        installationId: installationIdParam,
        search: search.trim() || undefined,
        page,
        perPage: 10,
        sortBy,
      }),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Repositories
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            GitHub repositories authorized for automated AI and deterministic
            code review.
          </p>
        </div>

        {installationIdParam && (
          <div className="inline-flex items-center space-x-2 bg-slate-800 text-xs px-3 py-1.5 rounded-lg border border-slate-700">
            <span className="text-slate-400">Filtered by installation:</span>
            <span className="font-mono text-cyan-400">
              #{installationIdParam}
            </span>
            <button
              onClick={() => onNavigate("#/repositories")}
              className="text-slate-400 hover:text-white ml-2 font-bold"
              title="Clear filter"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Filters & Search Toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <label htmlFor={searchInputId} className="sr-only">
            Search repositories
          </label>
          <input
            id={searchInputId}
            type="text"
            placeholder="Search repositories..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
              className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center space-x-3 self-end sm:self-auto">
          <label htmlFor={sortSelectId} className="text-xs text-slate-400">
            Sort by:
          </label>
          <select
            id={sortSelectId}
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as "name" | "recent");
              setPage(1);
            }}
            aria-label="Sort repositories by"
            className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500"
          >
            <option value="recent">Recently Reviewed</option>
            <option value="name">Repository Name</option>
          </select>
        </div>
      </div>

      {/* Content Area */}
      {isLoading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="flex flex-col items-center space-y-3">
            <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-400">Loading repositories...</p>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-6 text-center">
          <h3 className="text-base font-semibold text-rose-400">
            Failed to load repositories
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            {(error as Error)?.message ?? "An unexpected error occurred."}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      ) : data?.repositories.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center max-w-md mx-auto">
          <p className="text-sm text-slate-300">
            No matching repositories found.
          </p>
          {search && (
            <button
              onClick={() => setSearch("")}
              className="mt-3 text-xs text-cyan-400 hover:underline"
            >
              Clear search filter
            </button>
          )}
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/60 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-3 font-semibold">Repository</th>
                  <th className="px-6 py-3 font-semibold">Permissions</th>
                  <th className="px-6 py-3 font-semibold">Reviews</th>
                  <th className="px-6 py-3 font-semibold">Latest Review</th>
                  <th className="px-6 py-3 font-semibold text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {data?.repositories.map((repo) => (
                  <tr
                    key={repo.repositoryGithubId}
                    className="hover:bg-slate-850/40 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-semibold text-white flex items-center space-x-2">
                          <span>{repo.fullName}</span>
                          <a
                            href={`https://github.com/${repo.fullName}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-500 hover:text-slate-300 transition-colors"
                            title="Open repository on GitHub"
                          >
                            ↗
                          </a>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 font-mono">
                          ID: {repo.repositoryGithubId}
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-1.5">
                        {repo.permissions?.admin && (
                          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-amber-950/60 text-amber-400 border border-amber-800/60">
                            Admin
                          </span>
                        )}
                        {repo.permissions?.push && (
                          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                            Write
                          </span>
                        )}
                        {repo.permissions?.pull && !repo.permissions?.push && (
                          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            Read
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-6 py-4 text-slate-300 font-mono text-sm">
                      {repo.totalReviews}
                    </td>

                    <td className="px-6 py-4">
                      {repo.latestReviewStatus ? (
                        <div className="space-y-1">
                          <StatusBadge status={repo.latestReviewStatus} />
                          {repo.latestReviewAt && (
                            <div className="text-[11px] text-slate-500">
                              {new Date(repo.latestReviewAt).toLocaleDateString(
                                undefined,
                                {
                                  month: "short",
                                  day: "numeric",
                                },
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">None yet</span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right space-x-2">
                      {repo.id && (
                        <button
                          onClick={() =>
                            onNavigate(`#/reviews?repositoryId=${repo.id}`)
                          }
                          className="px-3 py-1 text-xs font-semibold text-cyan-400 hover:text-cyan-300 bg-cyan-950/30 hover:bg-cyan-950/60 border border-cyan-800/50 rounded-lg transition-colors"
                        >
                          View Reviews →
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="p-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <div>
                Showing page <strong className="text-white">{data.page}</strong>{" "}
                of <strong className="text-white">{data.totalPages}</strong> (
                {data.total} repositories)
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 rounded border border-slate-700 text-white transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() =>
                    setPage((p) => Math.min(data.totalPages, p + 1))
                  }
                  disabled={page >= data.totalPages}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 rounded border border-slate-700 text-white transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
