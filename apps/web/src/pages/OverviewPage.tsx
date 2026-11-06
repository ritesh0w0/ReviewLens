import { useQuery } from "@tanstack/react-query";
import { fetchDashboardOverview } from "../api/client.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { SeverityBadge } from "../components/SeverityBadge.js";

interface OverviewPageProps {
  onNavigate: (path: string) => void;
}

export function OverviewPage({ onNavigate }: OverviewPageProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard-overview"],
    queryFn: fetchDashboardOverview,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Loading overview...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-6 text-center">
        <h3 className="text-base font-semibold text-rose-400">
          Failed to load overview
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
    );
  }

  const {
    totalRepositories,
    totalReviews,
    statusCounts,
    findingsBySeverity,
    recentReviews,
  } = data;

  const totalFindings = Object.values(findingsBySeverity).reduce(
    (a, b) => a + b,
    0,
  );

  return (
    <div className="space-y-8">
      {/* Top Banner / Heading */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Overview
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Pull request code review summary, telemetry, and evidence verification
          health.
        </p>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Repositories */}
        <div
          onClick={() => onNavigate("#/repositories")}
          className="cursor-pointer bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-5 transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Repositories
            </span>
            <span className="text-cyan-400 text-lg">📁</span>
          </div>
          <p className="mt-3 text-3xl font-bold text-white">
            {totalRepositories}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Authorized GitHub repositories
          </p>
        </div>

        {/* Total Reviews */}
        <div
          onClick={() => onNavigate("#/reviews")}
          className="cursor-pointer bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-5 transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Total Reviews
            </span>
            <span className="text-emerald-400 text-lg">⚡</span>
          </div>
          <p className="mt-3 text-3xl font-bold text-white">{totalReviews}</p>
          <div className="mt-1 flex items-center space-x-2 text-xs text-slate-500">
            <span>{statusCounts.SUCCEEDED ?? 0} succeeded</span>
            {Boolean(statusCounts.FAILED) && (
              <span className="text-rose-400">
                · {statusCounts.FAILED} failed
              </span>
            )}
          </div>
        </div>

        {/* Total Findings */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Total Findings
            </span>
            <span className="text-amber-400 text-lg">🔍</span>
          </div>
          <p className="mt-3 text-3xl font-bold text-white">{totalFindings}</p>
          <p className="mt-1 text-xs text-slate-500">
            Validated issues across all reviewed PRs
          </p>
        </div>

        {/* Success Rate */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Review Success Rate
            </span>
            <span className="text-indigo-400 text-lg">🎯</span>
          </div>
          <p className="mt-3 text-3xl font-bold text-white">
            {totalReviews > 0
              ? `${Math.round(((statusCounts.SUCCEEDED ?? 0) / totalReviews) * 100)}%`
              : "N/A"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {statusCounts.SUCCEEDED ?? 0} of {totalReviews} completed
          </p>
        </div>
      </div>

      {/* Severity Breakdown Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-base font-semibold text-white tracking-tight mb-4">
          Findings by Severity
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const).map(
            (sev) => {
              const count = findingsBySeverity[sev] ?? 0;
              return (
                <div
                  key={sev}
                  className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3 text-center"
                >
                  <div className="flex justify-center mb-1.5">
                    <SeverityBadge severity={sev} />
                  </div>
                  <div className="text-2xl font-bold text-white">{count}</div>
                </div>
              );
            },
          )}
        </div>
      </div>

      {/* Recent Reviews Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white tracking-tight">
              Recent Pull Request Reviews
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Latest asynchronous reviews processed by ReviewLens
            </p>
          </div>
          <button
            onClick={() => onNavigate("#/reviews")}
            className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            View all →
          </button>
        </div>

        {recentReviews.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <p className="text-sm">No pull requests have been reviewed yet.</p>
            <p className="text-xs text-slate-500 mt-1">
              Open or update a pull request on an installed repository to
              trigger review.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/60 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-3 font-semibold">Pull Request</th>
                  <th className="px-6 py-3 font-semibold">Repository</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold">Files</th>
                  <th className="px-6 py-3 font-semibold">Findings</th>
                  <th className="px-6 py-3 font-semibold">Date</th>
                  <th className="px-6 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {recentReviews.map((rev) => (
                  <tr
                    key={rev.id}
                    className="hover:bg-slate-850/50 transition-colors cursor-pointer"
                    onClick={() => onNavigate(`#/reviews/${rev.id}`)}
                  >
                    <td className="px-6 py-4 font-semibold text-white whitespace-nowrap">
                      #{rev.prNumber}
                    </td>
                    <td className="px-6 py-4 text-slate-300 whitespace-nowrap">
                      {rev.repository}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={rev.status} />
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
        )}
      </div>
    </div>
  );
}
