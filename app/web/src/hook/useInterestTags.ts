import { useQuery } from "@tanstack/react-query";
import { fetchCategories } from "@/api/client";

export function useInterestTags() {
  return useQuery({
    queryKey: ['interest-tags'],
    queryFn: async () => {
      // Categories serve as interest tags in the Express backend.
      const res = await fetchCategories();
      return (res.data || []).map((cat) => ({
        id: cat.value,
        name: cat.label,
        value: cat.value,
        emoji: cat.emoji,
      }));
    },
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}
