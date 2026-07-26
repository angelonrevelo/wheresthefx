import { db, sourceAccount } from '@wheresthefx/db';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';

/**
 * Watchlist persistence.
 *
 * A "source account" is an Instagram account the scraper follows: venues,
 * promoters, organisers. The profile columns here are not decoration —
 * `venue_type` and `category_distribution` feed the extractor's
 * venue-profile override, which is the single strongest lever on
 * category accuracy.
 */

export type AccountCategory = 'nightlife' | 'venue' | 'promoter' | 'artist' | 'community' | 'other';

export interface AccountDraft {
  username: string;
  igUserId?: string | null;
  fullName?: string | null;
  bio?: string | null;
  profilePicUrl?: string | null;
  followerCount?: number | null;
  followingCount?: number | null;
  postCount?: number | null;
  isVerified?: boolean;
  isBusiness?: boolean;
  category?: AccountCategory;
  venueType?: string | null;
  categoryDistribution?: Record<string, number> | null;
  typicalHours?: string | null;
  recurringEvent?: { name: string; frequency: string }[] | null;
  isActive?: boolean;
}

export async function upsertAccount(draft: AccountDraft): Promise<number> {
  const [row] = await db.insert(sourceAccount)
    .values({
      username: draft.username,
      igUserId: draft.igUserId ?? null,
      fullName: draft.fullName ?? null,
      bio: draft.bio ?? null,
      profilePicUrl: draft.profilePicUrl ?? null,
      followerCount: draft.followerCount ?? null,
      followingCount: draft.followingCount ?? null,
      postCount: draft.postCount ?? null,
      isVerified: draft.isVerified ?? false,
      isBusiness: draft.isBusiness ?? false,
      category: draft.category ?? 'other',
      venueType: draft.venueType ?? null,
      categoryDistribution: draft.categoryDistribution ?? null,
      typicalHours: draft.typicalHours ?? null,
      recurringEvent: draft.recurringEvent ?? null,
      isActive: draft.isActive ?? true,
    })
    .onConflictDoUpdate({
      target: sourceAccount.username,
      set: {
        // Only overwrite the cached user id when we actually have one:
        // losing it costs a rate-limited lookup on the next run.
        ...(draft.igUserId ? { igUserId: draft.igUserId } : {}),
        fullName: draft.fullName ?? null,
        bio: draft.bio ?? null,
        profilePicUrl: draft.profilePicUrl ?? null,
        followerCount: draft.followerCount ?? null,
        followingCount: draft.followingCount ?? null,
        postCount: draft.postCount ?? null,
        isVerified: draft.isVerified ?? false,
        isBusiness: draft.isBusiness ?? false,
        ...(draft.category ? { category: draft.category } : {}),
        ...(draft.venueType ? { venueType: draft.venueType } : {}),
        ...(draft.categoryDistribution ? { categoryDistribution: draft.categoryDistribution } : {}),
        ...(draft.typicalHours ? { typicalHours: draft.typicalHours } : {}),
        ...(draft.recurringEvent ? { recurringEvent: draft.recurringEvent } : {}),
      },
    })
    .returning({ sourceAccountId: sourceAccount.sourceAccountId });

  return row.sourceAccountId;
}

export interface ScrapeTarget {
  sourceAccountId: number;
  username: string;
  igUserId: string | null;
  venueType: string | null;
  categoryDistribution: Record<string, number> | null;
  typicalHours: string | null;
  recurringEvent: { name: string; frequency: string }[] | null;
}

/**
 * Accounts due for a scrape, least-recently-scraped first.
 *
 * Ordering by staleness rather than id means an interrupted run resumes
 * where it left off on its own, without needing to track progress.
 */
export async function listScrapeTarget(limit: number, staleHour = 20): Promise<ScrapeTarget[]> {
  const cutoff = new Date(Date.now() - staleHour * 60 * 60 * 1000);

  return db.select({
    sourceAccountId: sourceAccount.sourceAccountId,
    username: sourceAccount.username,
    igUserId: sourceAccount.igUserId,
    venueType: sourceAccount.venueType,
    categoryDistribution: sourceAccount.categoryDistribution,
    typicalHours: sourceAccount.typicalHours,
    recurringEvent: sourceAccount.recurringEvent,
  })
    .from(sourceAccount)
    .where(and(
      eq(sourceAccount.isActive, true),
      or(isNull(sourceAccount.lastScrapedAt), lt(sourceAccount.lastScrapedAt, cutoff)),
    ))
    .orderBy(sql`${sourceAccount.lastScrapedAt} ASC NULLS FIRST`, asc(sourceAccount.username))
    .limit(limit);
}

export async function markAccountScraped(sourceAccountId: number, igUserId?: string | null) {
  await db.update(sourceAccount).set({
    lastScrapedAt: new Date(),
    ...(igUserId ? { igUserId } : {}),
  }).where(eq(sourceAccount.sourceAccountId, sourceAccountId));
}
