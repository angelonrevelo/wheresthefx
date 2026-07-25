import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchPreference, updatePreference, isLoggedIn } from "@/api/client";

const PREFERENCE_KEY = ['user-preference'] as const;

/**
 * Onboarding completion is tracked client-side.
 *
 * It used to be derived as `preference.length > 0`, which meant a user
 * who deliberately picked no interests was shown the onboarding flow on
 * every single session, forever, with no way to dismiss it.
 */
const ONBOARDING_KEY = 'wtfx_onboarding_complete';

function readOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'true';
  } catch {
    return false;
  }
}

function markOnboardingComplete(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, 'true');
  } catch {
    // Private browsing / storage disabled — onboarding simply reappears.
  }
}

export function useUserPreferences() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: PREFERENCE_KEY,
    queryFn: async () => {
      if (!isLoggedIn()) return null;
      const { category } = await fetchPreference();
      return { interestTag: Array.isArray(category) ? category : [] };
    },
  });

  const mutation = useMutation({
    mutationFn: async (interestTag: string[]) => {
      if (!isLoggedIn()) throw new Error('Not authenticated');
      await updatePreference(interestTag);
      markOnboardingComplete();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PREFERENCE_KEY });
    },
  });

  return {
    interestTag: query.data?.interestTag,
    // Undefined while loading, so callers can distinguish "not yet known"
    // from "genuinely not done" and avoid flashing the onboarding sheet.
    hasCompletedOnboarding: query.isLoading ? undefined : readOnboardingComplete(),
    isLoading: query.isLoading,
    updatePreference: mutation.mutate,
  };
}
