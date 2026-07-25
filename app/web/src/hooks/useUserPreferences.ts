import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMe, updatePreferences as apiUpdatePreferences, isLoggedIn } from "@/api/client";

interface UserPreferences {
  interest_tags?: string[];
  has_completed_onboarding?: boolean;
}

export function useUserPreferences() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['user-preferences'],
    queryFn: async () => {
      if (!isLoggedIn()) return null;
      const user = await getMe();
      const prefs = Array.isArray(user.preferences) ? user.preferences : [];
      return {
        preferences: { interest_tags: prefs } satisfies UserPreferences,
        has_completed_onboarding: prefs.length > 0,
      };
    },
  });

  const updatePrefsMutation = useMutation({
    mutationFn: async (preferences: UserPreferences) => {
      if (!isLoggedIn()) throw new Error('Not authenticated');
      await apiUpdatePreferences(preferences.interest_tags || []);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-preferences'] });
    },
  });

  return {
    preferences: query.data?.preferences,
    hasCompletedOnboarding: query.data?.has_completed_onboarding,
    isLoading: query.isLoading,
    updatePreferences: updatePrefsMutation.mutate,
  };
}
