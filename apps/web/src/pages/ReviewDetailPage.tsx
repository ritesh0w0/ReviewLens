import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchReviewDetail,
  fetchReviewFindings,
  fetchReviewExecution,
} from "../api/client.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { SeverityBadge } from "../components/SeverityBadge.js";

interface ReviewDetailPageProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

type TabType = "summary" | "findings" | "execution";

export function ReviewDetailPage({
  currentPath,
  onNavigate,
}: ReviewDetailPageProps) {
  // Path format: #/reviews/:id
  const match = currentPath.match(/^#\/reviews\/([^/?]+)/);
  const reviewId = match ? match[1] : "";

  const [activeTab, setActiveTab] = useState<TabType>("summary");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [provenanceFilter, setProvenanceFilter] = useState<string>("ALL");

  const detailQuery = useQuery({
    queryKey: ["review-detail", reviewId],
    queryFn: () => fetchReviewDetail(reviewId),
    enabled: Boolean(reviewId),
  });

  const findingsQuery = useQuery({
    queryKey: ["review-findings", reviewId],
    queryFn: () => fetchReviewFindings(reviewId),
    enabled: Boolean(reviewId),
  });

  const executionQuery = useQuery({
    queryKey: ["review-execution", reviewId],
    queryFn: () => fetchReviewExecution(reviewId),
    enabled: Boolean(reviewId),
  });

  if (!reviewId) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-400">Invalid review ID.</p>
        <button
          onClick={() => onNavigate("#/reviews")}
          className="mt-4 px-4 py-2 bg-slate-800 text-xs text-white rounded-lg"
        >
          Back to reviews
        </button>
      </div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">
            Loading review #{reviewId.slice(0, 8)}...
          </p>
        </div>
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    const is404 = (detailQuery.error as any)?.status === 404;
    return (
      <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-8 text-center max-w-lg mx-auto">
        <h3 className="text-base font-semibold text-rose-400">
          {is404
            ? "Review Not Found or Access Denied"
            : "Failed to load review"}
        </h3>
        <p className="mt-2 text-sm text-slate-400">
          {is404
            ? "This review run does not exist, or you do not have permission to view its repository."
            : ((detailQuery.error as Error)?.message ?? "An error occurred.")}
        </p>
        <button
          onClick={() => onNavigate("#/reviews")}
          className="mt-6 px-4 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
        >
          ← Return to Review History
        </button>
      </div>
    );
  }

  const review = detailQuery.data;
  const findings = findingsQuery.data?.findings ?? [];
  const execution = executionQuery.data;

  // Filter findings
  const filteredFindings = findings.filter((f) => {
    if (severityFilter !== "ALL" && f.severity !== severityFilter) return false;
    if (provenanceFilter !== "ALL" && f.provenance !== provenanceFilter)
      return false;
    return true;
  });

  // Calculate elapsed time
  let durationStr = "—";
  if (review.startedAt && review.finishedAt) {
    const ms =
      new Date(review.finishedAt).getTime() -
      new Date(review.startedAt).getTime();
    durationStr = `${(ms / 1000).toFixed(1)}s`;
  }

  const githubPrUrl = `https://github.com/${review.repository.fullName}/pull/${review.prNumber}`;

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onNavigate("#/reviews")}
          className="inline-flex items-center space-x-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <span>←</span>
          <span>Back to Reviews</span>
        </button>

        <a
          href={githubPrUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 rounded-lg border border-slate-700 transition-colors"
        >
          <span>View PR on GitHub</span>
          <span>↗</span>
        </a>
      </div>

      {/* Header Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold text-white tracking-tight">
                PR #{review.prNumber}
              </h1>
              <StatusBadge status={review.status} />
            </div>

            <p className="text-sm text-slate-300 mt-1 font-medium">
              {review.repository.fullName}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400 font-mono">
              <div>
                <span className="text-slate-500">Base: </span>
                <span>{review.baseSha.slice(0, 7)}</span>
              </div>
              <span>→</span>
              <div>
                <span className="text-slate-500">Head: </span>
                <span className="text-cyan-400">
                  {review.headSha.slice(0, 7)}
                </span>
              </div>
              {review.trigger && (
                <div className="font-sans text-slate-500">
                  Trigger:{" "}
                  <span className="text-slate-400">{review.trigger}</span>
                </div>
              )}
            </div>
          </div>

          {review.githubReviewId && (
            <div className="text-right">
              <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider">
                GitHub Advisory Review
              </span>
              <p className="text-xs font-mono text-emerald-400 mt-0.5">
                ID: {review.githubReviewId}
              </p>
            </div>
          )}
        </div>

        {/* Alerts for degraded / failed runs */}
        {review.failureReason && (
          <div className="mt-5 rounded-lg border border-rose-900/60 bg-rose-950/30 p-3.5 text-xs text-rose-300 flex items-start space-x-2.5">
            <span className="text-base">⚠️</span>
            <div>
              <strong className="font-semibold block mb-0.5">
                Review Failure:
              </strong>
              <span>{review.failureReason}</span>
            </div>
          </div>
        )}

        {review.degradedReason && (
          <div className="mt-5 rounded-lg border border-amber-900/60 bg-amber-950/30 p-3.5 text-xs text-amber-300 flex items-start space-x-2.5">
            <span className="text-base">⚠️</span>
            <div>
              <strong className="font-semibold block mb-0.5">
                Degraded Execution:
              </strong>
              <span>{review.degradedReason}</span>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="mt-8 border-b border-slate-800 flex space-x-8">
          <button
            onClick={() => setActiveTab("summary")}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "summary"
                ? "border-cyan-400 text-white font-semibold"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Summary & Metrics
          </button>

          <button
            onClick={() => setActiveTab("findings")}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === "findings"
                ? "border-cyan-400 text-white font-semibold"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <span>Findings</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                findings.length > 0
                  ? "bg-cyan-950 text-cyan-400 border border-cyan-800"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              {findings.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("execution")}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === "execution"
                ? "border-cyan-400 text-white font-semibold"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <span>AI Execution</span>
            {review.aiExecution && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
        </div>
      </div>

      {/* Tab 1: Summary */}
      {activeTab === "summary" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Execution Timing */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Execution Timing
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Created At</span>
                <span className="text-white">
                  {new Date(review.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Started At</span>
                <span className="text-white">
                  {review.startedAt
                    ? new Date(review.startedAt).toLocaleTimeString()
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Finished At</span>
                <span className="text-white">
                  {review.finishedAt
                    ? new Date(review.finishedAt).toLocaleTimeString()
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Duration</span>
                <span className="text-white font-semibold">{durationStr}</span>
              </div>
            </div>
          </div>

          {/* Diff & Files */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Diff Scope
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Files Reviewed</span>
                <span className="text-white font-semibold">
                  {review.filesReviewed !== null && review.filesTotal !== null
                    ? `${review.filesReviewed} of ${review.filesTotal} files`
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Review Status</span>
                <span className="text-white">{review.status}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Trigger Event</span>
                <span className="text-white font-mono text-[11px]">
                  {review.trigger}
                </span>
              </div>
            </div>
          </div>

          {/* Findings Summary */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Findings Telemetry
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Candidate Findings</span>
                <span className="text-white font-semibold">
                  {review.candidateCount ?? 0}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Published / Posted</span>
                <span className="text-emerald-400 font-semibold">
                  {review.postedCount ?? 0}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Filtered / Suppressed</span>
                <span className="text-slate-400">
                  {Math.max(
                    0,
                    (review.candidateCount ?? 0) - (review.postedCount ?? 0),
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Findings */}
      {activeTab === "findings" && (
        <div className="space-y-5">
          {/* Findings Filter Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-400">Severity:</span>
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-cyan-500"
                >
                  <option value="ALL">All Severities</option>
                  <option value="CRITICAL">Critical</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                  <option value="INFO">Info</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-400">Provenance:</span>
                <select
                  value={provenanceFilter}
                  onChange={(e) => setProvenanceFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-cyan-500"
                >
                  <option value="ALL">All Sources</option>
                  <option value="deterministic">Deterministic Rule</option>
                  <option value="ai">AI Model</option>
                </select>
              </div>
            </div>

            <span className="text-xs text-slate-400">
              Showing{" "}
              <strong className="text-white">{filteredFindings.length}</strong>{" "}
              of {findings.length} findings
            </span>
          </div>

          {/* Findings List */}
          {filteredFindings.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center max-w-md mx-auto">
              <div className="w-10 h-10 rounded-full bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 flex items-center justify-center mx-auto text-lg mb-3">
                ✓
              </div>
              <h4 className="text-sm font-semibold text-white">
                No findings to display
              </h4>
              <p className="mt-1 text-xs text-slate-400">
                {findings.length === 0
                  ? "No code defects or rule violations were found in this pull request."
                  : "No findings match the selected filters."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredFindings.map((finding) => (
                <div
                  key={finding.id}
                  className="bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-xl p-5 space-y-4 transition-colors"
                >
                  {/* Top Bar of Finding Card */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center space-x-2.5">
                      <SeverityBadge severity={finding.severity} />
                      <h4 className="text-sm font-semibold text-white">
                        {finding.title}
                      </h4>
                    </div>

                    <div className="flex items-center space-x-2 text-xs">
                      {/* Provenance badge */}
                      {finding.provenance === "deterministic" ? (
                        <span className="px-2 py-0.5 rounded bg-sky-950/80 text-sky-400 border border-sky-800/80 font-mono text-[11px]">
                          Rule: {finding.ruleId ?? "deterministic"}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-purple-950/80 text-purple-400 border border-purple-800/80 font-mono text-[11px]">
                          AI: {finding.modelId ?? "gemini"}
                        </span>
                      )}

                      {finding.confidence !== null && (
                        <span className="text-slate-400 text-[11px]">
                          Confidence: {Math.round(finding.confidence * 100)}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Location & Scope */}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 font-mono bg-slate-950/70 px-3 py-2 rounded-lg border border-slate-800">
                    <div className="flex items-center space-x-1">
                      <span className="text-slate-500">File:</span>
                      <span className="text-slate-200">
                        {finding.filePath ?? "Global (PR Scope)"}
                      </span>
                    </div>

                    {finding.line !== null && (
                      <div className="flex items-center space-x-1">
                        <span className="text-slate-500">Line:</span>
                        <span className="text-cyan-400 font-bold">
                          {finding.line} ({finding.side ?? "RIGHT"})
                        </span>
                      </div>
                    )}

                    <div className="flex items-center space-x-1">
                      <span className="text-slate-500">Category:</span>
                      <span className="text-slate-300 font-sans">
                        {finding.category}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1 ml-auto">
                      <span className="text-slate-500">Fingerprint:</span>
                      <span
                        className="text-slate-500"
                        title={finding.fingerprint}
                      >
                        {finding.fingerprint.slice(0, 8)}...
                      </span>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="text-xs text-slate-300 leading-relaxed">
                    <p className="whitespace-pre-wrap">{finding.description}</p>
                  </div>

                  {/* Actionable Recommendation */}
                  {finding.recommendation && (
                    <div className="bg-slate-950/90 border border-cyan-900/40 rounded-lg p-3.5 space-y-1.5">
                      <div className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider flex items-center space-x-1.5">
                        <span>💡</span>
                        <span>Recommendation</span>
                      </div>
                      <p className="text-xs text-slate-300 font-mono whitespace-pre-wrap">
                        {finding.recommendation}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: AI Execution Transparency */}
      {activeTab === "execution" && (
        <div className="space-y-6">
          {!execution?.available ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center max-w-md mx-auto">
              <div className="w-10 h-10 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center mx-auto text-lg mb-3">
                ℹ️
              </div>
              <h4 className="text-sm font-semibold text-white">
                No AI Execution Telemetry
              </h4>
              <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                {execution?.message ??
                  "AI review was not triggered, was skipped, or is disabled for this review run."}
              </p>
            </div>
          ) : (
            <>
              {/* Telemetry Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    AI Run Status
                  </span>
                  <div className="mt-2">
                    <StatusBadge status={execution.status ?? "UNKNOWN"} />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500 font-mono">
                    Profile: {execution.profile ?? "standard"}
                  </p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Model Routing
                  </span>
                  <p className="mt-2 text-sm font-mono font-semibold text-white truncate">
                    {execution.primaryModel}
                  </p>
                  {execution.finalModel &&
                    execution.finalModel !== execution.primaryModel && (
                      <p className="text-xs font-mono text-amber-400 mt-0.5 truncate">
                        Fallback: {execution.finalModel}
                      </p>
                    )}
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Tokens Consumed
                  </span>
                  <p className="mt-2 text-base font-bold text-white font-mono">
                    {(execution.totalInputTokens ?? 0) +
                      (execution.totalOutputTokens ?? 0)}
                  </p>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">
                    In: {execution.totalInputTokens ?? 0} | Out:{" "}
                    {execution.totalOutputTokens ?? 0}
                  </p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Candidate Validation
                  </span>
                  <p className="mt-2 text-base font-bold text-white">
                    {execution.totalCandidatesValidated ?? 0} /{" "}
                    {execution.totalCandidatesGenerated ?? 0}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Passed rigorous evidence gate
                  </p>
                </div>
              </div>

              {/* Chunks and Attempts Breakdown */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="p-5 border-b border-slate-800">
                  <h3 className="text-base font-semibold text-white">
                    Diff Chunks & Model Invocations
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Detailed per-chunk breakdown, attempt latency, and provider
                    responses
                  </p>
                </div>

                {execution.chunks && execution.chunks.length > 0 ? (
                  <div className="divide-y divide-slate-800">
                    {execution.chunks.map((chunk) => (
                      <div key={chunk.id} className="p-5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center space-x-3">
                            <span className="text-xs font-mono font-bold text-cyan-400">
                              Chunk #{chunk.chunkIndex}
                            </span>
                            <StatusBadge status={chunk.status} />
                            <span className="text-xs font-mono text-slate-400">
                              {chunk.modelId}
                            </span>
                          </div>

                          <div className="text-xs text-slate-400 font-mono">
                            Tokens: {chunk.inputTokens} in /{" "}
                            {chunk.outputTokens} out
                          </div>
                        </div>

                        {/* File Paths in chunk */}
                        <div className="text-xs text-slate-400 font-mono bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                          <span className="text-slate-500 block mb-1">
                            Target Files:
                          </span>
                          <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                            {chunk.filePaths.map((fp, i) => (
                              <li key={i}>{fp}</li>
                            ))}
                          </ul>
                        </div>

                        {/* Attempts */}
                        {chunk.attempts && chunk.attempts.length > 0 && (
                          <div className="pt-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block mb-1.5">
                              Attempts ({chunk.attempts.length})
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                              {chunk.attempts.map((att, i) => (
                                <div
                                  key={i}
                                  className="bg-slate-950/80 border border-slate-800/80 rounded p-2 text-xs space-y-1 font-mono"
                                >
                                  <div className="flex justify-between items-center">
                                    <span className="text-slate-400">
                                      Attempt #{att.attemptNumber}
                                    </span>
                                    <span
                                      className={
                                        att.status === "SUCCEEDED"
                                          ? "text-emerald-400 font-bold"
                                          : "text-rose-400 font-bold"
                                      }
                                    >
                                      {att.status}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 flex justify-between">
                                    <span>Latency: {att.latencyMs}ms</span>
                                    <span>{att.provider}</span>
                                  </div>
                                  {att.errorCategory && (
                                    <div className="text-rose-400 text-[10px]">
                                      Error: {att.errorCategory}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400">
                    No chunk records recorded.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
