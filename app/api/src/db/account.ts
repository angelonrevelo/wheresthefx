import { db } from '@wheresthefx/db';
import { account, accountPreference, savedEvent } from '@wheresthefx/db';
import { and, asc, eq } from 'drizzle-orm';

/** Account, saved-event, and preference data access. */

export interface NewAccount {
  email: string;
  username: string;
  passwordHash: string;
  displayName?: string;
}

/**
 * Create an account and its preference row in one transaction.
 *
 * Uniqueness is left to the database constraint rather than a prior
 * SELECT: the check-then-insert form had a race that turned concurrent
 * signups into a 500, and branching the error message on which field
 * collided made the user table enumerable.
 */
export async function createAccount(input: NewAccount) {
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(account).values({
      email: input.email,
      username: input.username,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
    }).returning();

    await tx.insert(accountPreference).values({
      accountId: created.accountId,
      preferredCategory: [],
    });

    return created;
  });
}

export async function findAccountByEmail(email: string) {
  return db.query.account.findFirst({ where: eq(account.email, email) });
}

export async function findAccountProfile(accountId: number) {
  return db.query.account.findFirst({
    where: eq(account.accountId, accountId),
    with: { preference: true },
  });
}

export async function findSavedEvent(accountId: number, eventId: number) {
  return db.query.savedEvent.findFirst({
    where: and(eq(savedEvent.accountId, accountId), eq(savedEvent.eventId, eventId)),
  });
}

export async function insertSavedEvent(accountId: number, eventId: number) {
  await db.insert(savedEvent).values({ accountId, eventId });
}

export async function deleteSavedEvent(accountId: number, eventId: number) {
  await db.delete(savedEvent).where(
    and(eq(savedEvent.accountId, accountId), eq(savedEvent.eventId, eventId)),
  );
}

/** Saved events with venue data, oldest save first. */
export async function listSavedEvent(accountId: number) {
  return db.query.savedEvent.findMany({
    where: eq(savedEvent.accountId, accountId),
    with: { event: { with: { venue: true } } },
    orderBy: [asc(savedEvent.savedAt)],
  });
}

export async function findPreference(accountId: number) {
  return db.query.accountPreference.findFirst({
    where: eq(accountPreference.accountId, accountId),
  });
}

/** Replace an account's preferred categories, inserting the row if absent. */
export async function upsertPreference(accountId: number, categoryList: string[]) {
  const existing = await findPreference(accountId);

  if (existing) {
    await db.update(accountPreference)
      .set({ preferredCategory: categoryList, updatedAt: new Date() })
      .where(eq(accountPreference.accountId, accountId));
    return;
  }

  await db.insert(accountPreference).values({
    accountId,
    preferredCategory: categoryList,
  });
}
