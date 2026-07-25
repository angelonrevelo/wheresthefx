import { useQuery } from "@tanstack/react-query";
import { fetchSavedEvents, isLoggedIn } from "@/api/client";

export function useSavedEvents() {
  return useQuery({
    queryKey: ['saved-events'],
    queryFn: async () => {
      if (!isLoggedIn()) return [];
      const res = await fetchSavedEvents();
      return res.data || [];
    },
    staleTime: 5 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}
