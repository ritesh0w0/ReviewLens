interface SeverityBadgeProps {
  severity: string;
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const norm = severity.toUpperCase();

  let styles = "bg-slate-800 text-slate-300 border-slate-700";

  switch (norm) {
    case "CRITICAL":
      styles = "bg-red-950 text-red-300 border-red-700";
      break;
    case "HIGH":
      styles = "bg-rose-950/80 text-rose-300 border-rose-800";
      break;
    case "MEDIUM":
      styles = "bg-amber-950/80 text-amber-300 border-amber-800";
      break;
    case "LOW":
      styles = "bg-blue-950/80 text-blue-300 border-blue-800";
      break;
    case "INFO":
      styles = "bg-slate-900 text-slate-400 border-slate-800";
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider border ${styles}`}
    >
      {norm}
    </span>
  );
}
