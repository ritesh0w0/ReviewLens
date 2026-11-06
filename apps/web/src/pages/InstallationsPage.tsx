import { useQuery } from "@tanstack/react-query";
import { fetchInstallations } from "../api/client.js";

interface InstallationsPageProps {
  onNavigate: (path: string) => void;
}

export function InstallationsPage({ onNavigate }: InstallationsPageProps) {
  const {
    data: installations,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["installations"],
    queryFn: fetchInstallations,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">
            Loading GitHub installations...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-6 text-center">
        <h3 className="text-base font-semibold text-rose-400">
          Failed to load installations
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

  const items = installations ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            GitHub Installations
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Accounts and organizations where the ReviewLens GitHub App is
            installed and accessible to your account.
          </p>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="self-start sm:self-auto inline-flex items-center space-x-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 rounded-lg transition-colors"
        >
          <span className={isFetching ? "animate-spin" : ""}>🔄</span>
          <span>{isFetching ? "Refreshing..." : "Sync Access"}</span>
        </button>
      </div>

      {items.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center max-w-xl mx-auto space-y-4">
          <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-2xl">
            📦
          </div>
          <h2 className="text-lg font-semibold text-white">
            No accessible installations found
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            ReviewLens has not been installed on any GitHub accounts or
            organizations you have permission to view, or your access grants
            have not synced yet.
          </p>
          <div className="pt-2">
            <button
              onClick={() => refetch()}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors"
            >
              Refresh Access Grants
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((inst) => (
            <div
              key={inst.id}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-6 flex flex-col justify-between transition-all"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    {inst.accountAvatarUrl ? (
                      <img
                        src={inst.accountAvatarUrl}
                        alt={inst.accountLogin}
                        className="w-10 h-10 rounded-full border border-slate-700"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 font-bold">
                        {inst.accountLogin.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <h3 className="text-base font-semibold text-white">
                        {inst.accountLogin}
                      </h3>
                      <span className="inline-block mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-1.5 py-0.2 rounded bg-slate-800 border border-slate-700">
                        {inst.accountType}
                      </span>
                    </div>
                  </div>

                  <span className="text-xs font-mono text-slate-500">
                    #{inst.installationGithubId}
                  </span>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">
                      Accessible Repositories
                    </span>
                    <span className="font-semibold text-white bg-slate-800 px-2 py-0.5 rounded">
                      {inst.repositoryCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Grant Refreshed</span>
                    <span className="text-slate-500">
                      {new Date(inst.refreshedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800">
                <button
                  onClick={() =>
                    onNavigate(
                      `#/repositories?installationId=${inst.installationGithubId}`,
                    )
                  }
                  className="w-full py-2 px-3 text-xs font-semibold text-cyan-400 hover:text-cyan-300 bg-cyan-950/30 hover:bg-cyan-950/60 border border-cyan-800/50 rounded-lg transition-colors text-center"
                >
                  View Repositories ({inst.repositoryCount}) →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
