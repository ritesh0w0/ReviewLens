import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./context/AuthContext.js";
import { useAuth } from "./context/useAuth.js";
import { Navbar } from "./components/Navbar.js";
import { LoginPage } from "./pages/LoginPage.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { InstallationsPage } from "./pages/InstallationsPage.js";
import { RepositoriesPage } from "./pages/RepositoriesPage.js";
import { ReviewsPage } from "./pages/ReviewsPage.js";
import { ReviewDetailPage } from "./pages/ReviewDetailPage.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AppRouter() {
  const { isAuthenticated, isLoading } = useAuth();
  const [currentPath, setCurrentPath] = useState(
    () => window.location.hash || "#/",
  );

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentPath(window.location.hash || "#/");
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigate = (path: string) => {
    window.location.hash = path;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Verifying session...</p>
        </div>
      </div>
    );
  }

  // Unauthenticated users see Login Page
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col">
        <Navbar currentPath={currentPath} onNavigate={navigate} />
        <LoginPage />
      </div>
    );
  }

  // Route matching
  const renderPage = () => {
    if (currentPath === "#/" || currentPath === "") {
      return <OverviewPage onNavigate={navigate} />;
    }
    if (currentPath.startsWith("#/installations")) {
      return <InstallationsPage onNavigate={navigate} />;
    }
    if (currentPath.startsWith("#/repositories")) {
      return (
        <RepositoriesPage currentPath={currentPath} onNavigate={navigate} />
      );
    }
    if (currentPath.match(/^#\/reviews\/[^/?]+/)) {
      return (
        <ReviewDetailPage currentPath={currentPath} onNavigate={navigate} />
      );
    }
    if (currentPath.startsWith("#/reviews")) {
      return <ReviewsPage currentPath={currentPath} onNavigate={navigate} />;
    }

    // Default fallback: Overview
    return <OverviewPage onNavigate={navigate} />;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <Navbar currentPath={currentPath} onNavigate={navigate} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {renderPage()}
      </main>
      <footer className="border-t border-slate-900 bg-slate-950/50 py-6 text-center text-xs text-slate-600">
        ReviewLens — Evidence-First AI Pull Request Reviewer · Milestone M6
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </QueryClientProvider>
  );
}
