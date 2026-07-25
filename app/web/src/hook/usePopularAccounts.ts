// TODO: needs admin API endpoint — GET /api/accounts/popular
// No Express endpoint exists yet for popular Instagram accounts.
export function usePopularAccounts(_limit: number = 30) {
  return { data: [] as any[], isLoading: false, error: null };
}
