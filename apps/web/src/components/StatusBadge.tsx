interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const normalized = status.toUpperCase();

  let colorClasses = "bg-slate-800 text-slate-300 border-slate-700";

  switch (normalized) {
    case "SUCCEEDED":
    case "COMPLETE":
    case "COMPLETED":
      colorClasses = "bg-emerald-950/70 text-emerald-400 border-emerald-800/80";
      break;
    case "FAILED":
      colorClasses = "bg-rose-950/70 text-rose-400 border-rose-800/80";
      break;
    case "RUNNING":
      colorClasses =
        "bg-sky-950/70 text-sky-400 border-sky-800/80 animate-pulse";
      break;
    case "DEGRADED":
    case "PARTIAL":
      colorClasses = "bg-amber-950/70 text-amber-400 border-amber-800/80";
      break;
    case "SKIPPED":
    case "SUPERSEDED":
    case "NOT_NEEDED":
      colorClasses = "bg-slate-900 text-slate-400 border-slate-800";
      break;
    case "QUEUED":
    case "PENDING":
      colorClasses = "bg-indigo-950/70 text-indigo-400 border-indigo-800/80";
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colorClasses}`}
    >
      {normalized}
    </span>
  );
}
