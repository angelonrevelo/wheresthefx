import 'dotenv/config';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Save an Instagram session for the scraper.
 *
 *   IG_USERNAME=... IG_PASSWORD=... npx tsx package/ingest/src/command/login.ts [--headed]
 *
 * ## Why this is needed
 *
 * The v1 feed endpoint serves public profiles anonymously, but Instagram
 * rate-limits an unauthenticated client hard — in testing, a 401 arrived
 * after roughly a dozen requests. A session raises that ceiling enough to
 * walk the whole watchlist.
 *
 * ## Why it runs headed by default
 *
 * Instagram frequently answers an automated login with a checkpoint:
 * 2FA, an email code, or a "was this you?" interstitial. None of those
 * can be cleared headlessly. Run this headed, clear the challenge by
 * hand, and the saved session is then reusable for weeks.
 */

const SESSION_PATH = process.env.IG_SESSION_PATH ?? 'data/session/ig-session.json';
const CHALLENGE_WAIT_MS = 180_000;

async function main(): Promise<void> {
  const username = process.env.IG_USERNAME;
  const password = process.env.IG_PASSWORD;

  if (!username || !password) {
    console.error('IG_USERNAME and IG_PASSWORD are required. Put them in .env.');
    process.exit(1);
  }

  // Headless is opt-in, not the default: see the note above.
  const isHeadless = process.argv.includes('--headless');

  const browser = await chromium.launch({
    headless: isHeadless,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const context = await browser.newContext({
    timezoneId: 'Asia/Manila',
    locale: 'en-PH',
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  try {
    console.log(`Logging in as @${username}...`);
    await page.goto('https://www.instagram.com/accounts/login/', {
      // The login form is client-rendered: `domcontentloaded` fires while
      // the page is still a bootstrap script and no input exists yet.
      waitUntil: 'networkidle',
      timeout: 60_000,
    });

    // Cookie banner, when the region shows one.
    const consent = page.getByRole('button', { name: /allow all|accept/i }).first();
    await consent.click({ timeout: 5000 }).catch(() => undefined);

    // Try to fill the form, but never depend on it.
    //
    // Instagram serves a bot-detection variant to some clients where the
    // form never renders, and answers others with a checkpoint. Both are
    // things a person can get past and a script cannot, so a failure
    // here is not fatal: the browser stays open and the loop below waits
    // for a session cookie however it arrives.
    let didAutofill = false;
    try {
      await page.waitForSelector('input[name="username"]', { timeout: 20_000 });
      await page.fill('input[name="username"]', username, { timeout: 15_000 });
      await page.fill('input[name="password"]', password);
      await page.getByRole('button', { name: /log in/i }).first().click();
      didAutofill = true;
      console.log('Credentials submitted.');
    } catch {
      console.log('\nCould not fill the form automatically.');
      if (isHeadless) {
        console.error('Re-run without --headless so you can log in by hand.');
        process.exitCode = 1;
        return;
      }
    }

    if (!isHeadless) {
      console.log(
        `\n  A browser window is open.\n` +
        `  ${didAutofill
          ? 'Clear any checkpoint it shows (2FA, "was this you?", a captcha).'
          : `Log in as @${username} yourself.`}\n` +
        `  This will detect the session automatically and save it.\n` +
        `  Waiting up to ${CHALLENGE_WAIT_MS / 60_000} minutes...\n`,
      );
    }

    // `sessionid` appearing is the only reliable signal of success —
    // Instagram's post-login redirects vary by account and challenge.
    const deadline = Date.now() + (isHeadless ? 45_000 : CHALLENGE_WAIT_MS);
    let isLoggedIn = false;

    while (Date.now() < deadline) {
      const cookieList = await context.cookies();
      if (cookieList.some(cookie => cookie.name === 'sessionid' && cookie.value)) {
        isLoggedIn = true;
        break;
      }
      // Dismiss the "Save your login info?" and "Turn on notifications"
      // interstitials, which otherwise block the redirect.
      await page.getByRole('button', { name: /not now/i }).first()
        .click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(2000);
    }

    if (!isLoggedIn) {
      console.error(
        '\nNo session cookie appeared.\n' +
        (isHeadless
          ? 'Instagram most likely presented a checkpoint. Re-run without --headless and clear it by hand.'
          : 'The challenge was not cleared in time, or the credentials were rejected.'),
      );
      process.exitCode = 1;
      return;
    }

    mkdirSync(dirname(SESSION_PATH), { recursive: true });
    const state = await context.storageState();
    writeFileSync(SESSION_PATH, JSON.stringify(state, null, 2));

    console.log(`\nSession saved to ${SESSION_PATH}`);
    console.log('This file is a live credential. It is gitignored; keep it that way.');
  } catch (err) {
    console.error('Login failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

void main();
