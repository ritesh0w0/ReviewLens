import { useAuth } from "../context/useAuth.js";

interface NavbarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function Navbar({ currentPath, onNavigate }: NavbarProps) {
  const { user, logout } = useAuth();

  const navLinks = [
    { label: "Overview", path: "#/" },
    { label: "Installations", path: "#/installations" },
    { label: "Repositories", path: "#/repositories" },
    { label: "Review History", path: "#/reviews" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-8">
          <div
            onClick={() => onNavigate("#/")}
            className="flex items-center space-x-2.5 cursor-pointer group"
          >
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-bold group-hover:border-cyan-400 transition-colors">
              RL
            </div>
            <span className="text-lg font-bold text-white tracking-tight">
              ReviewLens
            </span>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
              M6
            </span>
          </div>

          <nav className="hidden md:flex space-x-1">
            {navLinks.map((link) => {
              const isActive =
                link.path === currentPath ||
                (link.path === "#/reviews" &&
                  currentPath.startsWith("#/reviews/"));

              return (
                <button
                  key={link.path}
                  onClick={() => onNavigate(link.path)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-slate-800 text-white font-semibold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                >
                  {link.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center space-x-4">
          {user ? (
            <div className="flex items-center space-x-3">
              {user.avatarUrl && (
                <img
                  src={user.avatarUrl}
                  alt={user.githubLogin}
                  className="w-7 h-7 rounded-full border border-slate-700"
                />
              )}
              <span className="text-sm font-medium text-slate-300 hidden sm:inline">
                {user.githubLogin}
              </span>
              <button
                onClick={() => logout()}
                className="px-2.5 py-1 text-xs font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded border border-slate-800 hover:border-rose-900 transition-colors"
              >
                Sign out
              </button>
            </div>
          ) : (
            <a
              href="/api/auth/github"
              className="px-3 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded font-semibold transition-colors"
            >
              Sign in with GitHub
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
