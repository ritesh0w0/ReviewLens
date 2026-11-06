import type { ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchMe, logout as apiLogout } from "../api/client.js";
import { AuthContext, type AuthContextValue } from "./useAuth.js";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const logoutMutation = useMutation({
    mutationFn: apiLogout,
    onSuccess: () => {
      queryClient.setQueryData(["auth", "me"], { authenticated: false });
      queryClient.clear();
      window.location.hash = "#/login";
    },
  });

  const value: AuthContextValue = {
    user: data?.authenticated && data.user ? data.user : null,
    isAuthenticated: Boolean(data?.authenticated && data.user),
    isLoading,
    error: error as Error | null,
    logout: async () => {
      await logoutMutation.mutateAsync();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
