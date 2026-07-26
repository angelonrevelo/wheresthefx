import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { newInjectedContext } from 'fingerprint-injector';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Browser context for Instagram.
 *
 * Instagram fingerprints aggressively. A default Playwright context is
 * identifiable within one request, so the context is built with a
 * generated fingerprint, pinned to Manila, and stripped of the automation
 * markers that browsers under WebDriver expose by default.
 */

export interface StealthOption {
  headless?: boolean;
  /** Full proxy URL including credentials, e.g. http://user:pass@host:port */
  proxyUrl?: string | null;
  /** Playwright storageState JSON, or a raw cookie array. */
  sessionPath?: string | null;
}

export interface StealthSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** False when no session file was found; public profiles still work. */
  isAuthenticated: boolean;
  close(): Promise<void>;
}

/** Instagram's public web app id. Required by the v1 REST endpoints. */
export const IG_APP_ID = '936619743392459';

interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

/** Split a proxy URL into the shape Playwright expects. */
export function parseProxyUrl(raw: string | null | undefined): ProxyConfig | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `http://${raw}`);
    return {
      server: `${url.protocol}//${url.hostname}:${url.port || 80}`,
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    };
  } catch {
    console.warn(`  Ignoring unparseable proxy URL`);
    return null;
  }
}

/** Load a session file in either storageState or raw-cookie-array form. */
function loadStorageState(path: string): { cookieList: unknown[] } | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(parsed)) return { cookieList: parsed };
    if (Array.isArray(parsed?.cookies)) return { cookieList: parsed.cookies };
    return null;
  } catch (err) {
    console.warn(`  Session file unreadable: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Launch a browser context configured for Instagram.
 *
 * Authentication is optional by design: the v1 feed endpoint serves
 * public profiles without a session, and that path is far more durable
 * than the authenticated one. A session only raises rate limits.
 */
export async function createStealthSession(option: StealthOption = {}): Promise<StealthSession> {
  const browser = await chromium.launch({
    headless: option.headless ?? true,
    args: [
      // Removes the `navigator.webdriver` giveaway at the browser level.
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });

  const proxy = parseProxyUrl(option.proxyUrl);

  const context = await newInjectedContext(browser, {
    fingerprintOptions: {
      devices: ['desktop'],
      operatingSystems: ['windows', 'macos'],
      browsers: [{ name: 'chrome', minVersion: 115 }],
      locales: ['en-PH', 'en-US'],
    },
    newContextOptions: {
      // Manila, so timezone and geolocation agree with the content.
      timezoneId: 'Asia/Manila',
      locale: 'en-PH',
      geolocation: { latitude: 14.5995, longitude: 120.9842 },
      permissions: ['geolocation'],
      ...(proxy ? { proxy } : {}),
    },
  });

  // ChromeDriver leaves these on the document; real Chrome never has them.
  await context.addInitScript(() => {
    for (const key of Object.keys(document)) {
      if (key.startsWith('cdc_')) {
        delete (document as unknown as Record<string, unknown>)[key];
      }
    }
  });

  let isAuthenticated = false;
  if (option.sessionPath) {
    const state = loadStorageState(option.sessionPath);
    if (state?.cookieList.length) {
      await context.addCookies(state.cookieList as Parameters<typeof context.addCookies>[0]);
      isAuthenticated = true;
    }
  }

  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    isAuthenticated,
    async close() {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

/** Sleep with ±20% jitter, so request spacing is not machine-regular. */
export function jitteredDelay(baseMs: number): Promise<void> {
  const jitter = baseMs * 0.2;
  const delay = baseMs + (Math.random() * 2 - 1) * jitter;
  return new Promise(resolve => setTimeout(resolve, Math.max(0, delay)));
}
