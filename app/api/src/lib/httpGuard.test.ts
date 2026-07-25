import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import cors from 'cors';
import { checkImageUrl, resolveCacheDir } from './imageGuard.js';
import { firstParam } from './param.js';

/**
 * These exercise the middleware *behaviour* — the shape of the response a
 * caller actually receives — without needing a database. Route-level
 * integration against Postgres lands with the ingest work in M2.
 */

/** Mirrors the proxy's validation order in index.ts. */
function buildProxyApp(cacheRoot = '') {
  const app = express();
  app.get('/api/images/proxy', (req, res) => {
    const rawUrl = firstParam(req.query.url);
    const shortcode = firstParam(req.query.shortcode);

    if (!rawUrl) {
      res.status(400).json({ error: 'url parameter required' });
      return;
    }
    const checked = checkImageUrl(rawUrl);
    if (!checked.ok) {
      res.status(400).json({ error: `Invalid image url: ${checked.reason}` });
      return;
    }
    const cacheDir = shortcode ? resolveCacheDir(cacheRoot, shortcode) : null;
    res.json({ ok: true, cache_dir: cacheDir });
  });
  return app;
}

describe('image proxy request handling', () => {
  const app = buildProxyApp('/srv/ig-images');

  it('rejects a missing url with 400', async () => {
    const res = await request(app).get('/api/images/proxy');
    expect(res.status).toBe(400);
  });

  it('rejects the SSRF payloads with 400, never fetching them', async () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'https://169.254.169.254/latest/meta-data/',
      'file:///etc/passwd',
      'https://127.0.0.1:5432/',
      'https://evil.example.com/x.jpg',
    ]) {
      const res = await request(app).get('/api/images/proxy').query({ url });
      expect(res.status, `expected 400 for ${url}`).toBe(400);
      expect(res.body.error).toMatch(/Invalid image url/);
    }
  });

  it('accepts a legitimate CDN url', async () => {
    const res = await request(app)
      .get('/api/images/proxy')
      .query({ url: 'https://instagram.fmnl4-6.fna.fbcdn.net/v/t51/x.jpg' });
    expect(res.status).toBe(200);
  });

  it('refuses a traversal shortcode without resolving a directory', async () => {
    const res = await request(app).get('/api/images/proxy').query({
      url: 'https://scontent.cdninstagram.com/x.jpg',
      shortcode: '../../../../root/.ssh',
    });
    expect(res.status).toBe(200);
    expect(res.body.cache_dir).toBeNull();
  });

  it('resolves a legitimate shortcode', async () => {
    const res = await request(app).get('/api/images/proxy').query({
      url: 'https://scontent.cdninstagram.com/x.jpg',
      shortcode: 'C1a2B3c4D5e',
    });
    expect(res.body.cache_dir).toContain('C1a2B3c4D5e');
  });

  it('is not bypassed by a repeated url param', async () => {
    const res = await request(app)
      .get('/api/images/proxy')
      .query('url=https://169.254.169.254/&url=https://scontent.cdninstagram.com/x.jpg');
    // firstParam takes the first entry, which must still be validated.
    expect(res.status).toBe(400);
  });
});

/** Mirrors the CORS configuration in index.ts. */
function buildCorsApp(isProduction: boolean, allowed: string[]) {
  const app = express();
  const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowed.includes(origin)) return callback(null, true);
      if (!isProduction && LOCALHOST.test(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  }));
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('CORS policy', () => {
  it('allows a configured production origin', async () => {
    const app = buildCorsApp(true, ['https://www.wheresthefx.com']);
    const res = await request(app)
      .get('/api/ping')
      .set('Origin', 'https://www.wheresthefx.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://www.wheresthefx.com');
  });

  it('does NOT allow localhost in production', async () => {
    // This was permitted unconditionally, with credentials:true — so any
    // app on any developer's machine could read authenticated responses
    // from the production API.
    const app = buildCorsApp(true, ['https://www.wheresthefx.com']);
    const res = await request(app).get('/api/ping').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows localhost in development', async () => {
    const app = buildCorsApp(false, []);
    const res = await request(app).get('/api/ping').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('rejects a disallowed origin without throwing an HTML 500', async () => {
    // The old config called back with an Error, which Express's default
    // handler turned into an HTML 500 the JSON client could not parse.
    const app = buildCorsApp(true, ['https://www.wheresthefx.com']);
    const res = await request(app).get('/api/ping').set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.body).toEqual({ ok: true });
  });
});

describe('JSON 404 for unmatched API paths', () => {
  it('answers JSON, not Express HTML', async () => {
    const app = express();
    app.use('/api', (_req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
