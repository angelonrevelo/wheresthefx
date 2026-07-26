import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Guards the API paths this client requests.
 *
 * These are strings, so nothing type-checks them and a typo reaches the
 * browser as a 404 with no build error. That already happened: a
 * repo-wide rename singularising collection identifiers also rewrote
 * `/api/events` to `/api/event` inside a template literal, and the
 * sidebar silently fetched nothing until the page was actually opened
 * and its console read.
 *
 * The route names are plural because they are HTTP collections. That is
 * the one place the singular naming rule does not reach, and this test
 * is what stops a future rename reaching into it.
 */

const CLIENT_SOURCE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'client.ts'),
  'utf8',
);

/** Every path the API actually serves, from app/api/src/index.ts. */
const SERVED_PREFIX = [
  '/api/events',
  '/api/venues',
  '/api/categories',
  '/api/auth',
  '/api/users',
  '/api/images/proxy',
  '/api/health',
];

describe('API paths in the client', () => {
  const requested = [...CLIENT_SOURCE.matchAll(/["'`](\/api\/[^"'`$?]*)/g)]
    .map(match => match[1])
    .filter((path, index, all) => all.indexOf(path) === index);

  it('finds the paths at all, so this test cannot silently pass', () => {
    expect(requested.length).toBeGreaterThan(8);
  });

  it('only requests prefixes the server mounts', () => {
    for (const path of requested) {
      const isServed = SERVED_PREFIX.some(prefix => path.startsWith(prefix));
      expect(isServed, `client requests ${path}, which no router serves`).toBe(true);
    }
  });

  it('uses the plural collection names the routers are mounted under', () => {
    // The exact regression: `/api/event` instead of `/api/events`.
    for (const wrong of ['/api/event?', '/api/event`', '/api/venue`', '/api/category']) {
      expect(CLIENT_SOURCE, `client uses ${wrong}`).not.toContain(wrong);
    }
  });

  it('keeps the /me segment on user routes', () => {
    // Dropping it is what made saving an event 404 in production for the
    // entire life of the feature.
    for (const path of requested.filter(p => p.startsWith('/api/users'))) {
      expect(path, `${path} is missing /me`).toMatch(/^\/api\/users\/me\//);
    }
  });
});
