import { useState, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchReviews } from "../api/client.js";
import { StatusBadge } from "../components/StatusBadge.js";

interface ReviewsPageProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function ReviewsPage({ currentPath, onNavigate }: ReviewsPageProps) {
  const urlParts = currentPath.split("?");
  const searchParams = new URLSearchParams(urlParts[1] ?? "");
  const repositoryIdParam = searchParams.get("repositoryId") ?? undefined;
  const initialStatusParam = searchParams.get("status") ?? "";

  const [statusFilter, setStatusFilter] = useState(initialStatusParam);
  const [page, setPage] = useState(1);
  const statusSelectId = useId();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [
      "reviews",
      { repositoryId: repositoryIdParam, status: statusFilter, page },
    ],
    queryFn: () =>
      fetchReviews({
        repositoryId: repositoryIdParam,
        status: statusFilter || undefined,
        page,
        perPage: 12,
      }),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Review History
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Asynchronous pull request code reviews, findings summary, and
            execution status.
          </p>
        </div>

        {repositoryIdParam && (
          <div className="inline-flex items-center space-x-2 bg-slate-800 text-xs px-3 py-1.5 rounded-lg border border-slate-700">
            <span className="text-slate-400">Filtered by repository:</span>
            <span className="font-mono text-cyan-400">
              {repositoryIdParam.slice(0, 8)}...
            </span>
            <button
              onClick={() => onNavigate("#/reviews")}
              className="text-slate-400 hover:text-white ml-2 font-bold"
              title="Clear repository filter"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Filter toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <label
            htmlFor={statusSelectId}
            className="text-xs text-slate-400 font-medium"
          >
            Filter Status:
          </label>
          <select
            id={statusSelectId}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter reviews by status"
            className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500"
          >
            <option value="">All Statuses</option>
            <option value="SUCCEEDED">SUCCEEDED</option>
            <option value="FAILED">FAILED</option>
            <option value="RUNNING">RUNNING</option>
            <option value="DEGRADED">DEGRADED</option>
            <option value="SKIPPED">SKIPPED</option>
            <option value="QUEUED">QUEUED</option>
          </select>
        </div>

        {statusFilter && (
          <button
            onClick={() => {
              setStatusFilter("");
              setPage(1);
            }}
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            Reset filter
          </button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center min-h-[350px]">
          <div className="flex flex-col items-center space-y-3">
            <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-400">Loading reviews...</p>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-6 text-center">
          <h3 className="text-base font-semibold text-rose-400">
            Failed to load reviews
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
      ) : data?.reviews.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center max-w-md mx-auto">
          <p className="text-sm text-slate-300">
            No pull request reviews found.
          </p>
          {(statusFilter || repositoryIdParam) && (
            <button
              onClick={() => {
                setStatusFilter("");
                onNavigate("#/reviews");
              }}
              className="mt-3 text-xs text-cyan-400 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/60 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-3 font-semibold">Pull Request</th>
                  <th className="px-6 py-3 font-semibold">Repository</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold">Commit SHA</th>
                  <th className="px-6 py-3 font-semibold">Files</th>
                  <th className="px-6 py-3 font-semibold">Findings</th>
                  <th className="px-6 py-3 font-semibold">Created</th>
                  <th className="px-6 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {data?.reviews.map((rev) => (
                  <tr
                    key={rev.id}
                    className="hover:bg-slate-850/50 transition-colors cursor-pointer"
                    onClick={() => onNavigate(`#/reviews/${rev.id}`)}
                  >
                    <td className="px-6 py-4 font-semibold text-white whitespace-nowrap">
                      #{rev.prNumber}
                    </td>

                    <td className="px-6 py-4 text-slate-300 whitespace-nowrap">
                      {rev.repository.fullName}
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={rev.status} />
                    </td>

                    <td className="px-6 py-4 font-mono text-xs text-slate-400 whitespace-nowrap">
                      {rev.headSha.slice(0, 7)}
                    </td>

                    <td className="px-6 py-4 text-slate-400 whitespace-nowrap text-xs">
                      {rev.filesReviewed !== null && rev.filesTotal !== null
                        ? `${rev.filesReviewed} / ${rev.filesTotal}`
                        : "—"}
                    </td>

                    <td className="px-6 py-4 text-slate-400 whitespace-nowrap text-xs">
                      {rev.postedCount !== null ? (
                        <span>
                          <strong className="text-slate-200">
                            {rev.postedCount}
                          </strong>{" "}
                          posted
                          {rev.candidateCount !== null &&
                            rev.candidateCount !== rev.postedCount && (
                              <span className="text-slate-500">
                                {" "}
                                ({rev.candidateCount} found)
                              </span>
                            )}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className="px-6 py-4 text-slate-400 whitespace-nowrap text-xs">
                      {new Date(rev.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>

                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <span className="text-xs font-semibold text-cyan-400 hover:text-cyan-300">
                        Details →
                      </span>
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
                {data.total} reviews)
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPage((p) => Math.max(1, p - 1));
                  }}
                  disabled={page <= 1}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 rounded border border-slate-700 text-white transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPage((p) => Math.min(data.totalPages, p + 1));
                  }}
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
