import { API_BASE } from "../api/client.js";

export function LoginPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-bold text-xl mb-4">
            RL
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Sign in to ReviewLens
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Evidence-first AI code review dashboard and authorized pull request
            telemetry.
          </p>
        </div>

        <div className="mt-8 space-y-4">
          <a
            href={`${API_BASE}/auth/github`}
            className="w-full flex items-center justify-center space-x-3 px-4 py-3 bg-white hover:bg-slate-100 text-slate-950 font-semibold rounded-xl text-sm transition-colors shadow-sm"
          >
            <svg
              className="w-5 h-5 fill-current"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              />
            </svg>
            <span>Continue with GitHub</span>
          </a>

          <div className="pt-4 border-t border-slate-800 text-xs text-slate-500 space-y-1.5">
            <p className="flex items-center space-x-1.5">
              <span className="text-emerald-400">✓</span>
              <span>Authorization-code flow with PKCE S256</span>
            </p>
            <p className="flex items-center space-x-1.5">
              <span className="text-emerald-400">✓</span>
              <span>Encrypted token storage at rest (AES-256-GCM)</span>
            </p>
            <p className="flex items-center space-x-1.5">
              <span className="text-emerald-400">✓</span>
              <span>Strict per-user repository isolation</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
