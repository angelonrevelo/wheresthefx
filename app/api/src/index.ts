/**
 * WheresTheFX — Express Server Entry Point
 *
 * ## Route Structure
 *
 * | Path               | Router         | Description                |
 * |--------------------|----------------|----------------------------|
 * | /api/events        | events.ts      | Event discovery & detail   |
 * | /api/venues        | venues.ts      | Venue directory            |
 * | /api/categories    | categories.ts  | Category metadata          |
 * | /api/auth          | auth.ts        | Registration, login, /me   |
 * | /api/users         | users.ts       | Saved events, preferences  |
 * | /api/images/proxy  | (inline)       | Image proxy / cache        |
 * | /api/health        | (inline)       | Liveness + dependency check|
 *
 * ## Image Proxy
 *
 * Instagram CDN URLs expire within hours. The proxy:
 * 1. Serves a locally cached copy if one exists (instant, no network)
 * 2. Falls back to the CDN, and writes the result into the cache
 * 3. Returns 404 if neither has it
 *
 * Both inputs are attacker-controlled and both are validated — see
 * `lib/imageGuard.ts` for why that matters.
 */

import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { existsSync, readdirSync, createReadStream, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { sql } from '@wheresthefx/db';

import eventsRouter from './routes/events.js';
import venuesRouter from './routes/venues.js';
import categoriesRouter from './routes/categories.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import { snakeCaseResponse } from './middleware/snakeCase.js';
import {
  MAX_IMAGE_BYTE,
  checkImageUrl,
  contentTypeForFile,
  resolveCacheDir,
  safeContentType,
} from './lib/imageGuard.js';
import { firstParam } from './lib/param.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');
const BLEAD_IMAGES_PATH = process.env.BLEAD_IMAGES_PATH || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Behind Caddy. Without this, every client looks like the proxy's IP, so
// rate limiting would bucket the entire internet as a single caller.
app.set('trust proxy', 1);

app.use(helmet({
  // The API serves JSON and proxied images, never HTML, so the default
  // CSP would only ever be a footgun here.
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(compression());

const allowedOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean)
  : [];

const LOCALHOST_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(cors({
  origin: (origin, callback) => {
    // No Origin header: curl, server-to-server, same-origin. Allowed.
    if (!origin) return callback(null, true);

    if (allowedOrigin.includes(origin)) return callback(null, true);

    // Localhost is a dev convenience only. It used to be permitted in
    // production too, with credentials:true — meaning any app running on
    // a developer's (or victim's) machine could read authenticated
    // responses from api.wheresthefx.com.
    if (!IS_PRODUCTION && LOCALHOST_PATTERN.test(origin)) return callback(null, true);

    // Signalled as a non-error so the CORS layer simply omits the
    // allow-origin header. Throwing here produced an HTML 500 from
    // Express's default handler instead of a clean rejection.
    return callback(null, false);
  },
  credentials: true,
}));

app.use(express.json({ limit: '100kb' }));
app.use(snakeCaseResponse);

/** Generic ceiling for the whole API. */
const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

/**
 * Credential endpoints get a much tighter budget — these were entirely
 * unthrottled, leaving login open to credential stuffing and register
 * open as an account-creation faucet.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts, try again later' },
});

/** The proxy makes outbound requests, so it is an amplification vector. */
const imageLimiter = rateLimit({
  windowMs: 60_000,
  limit: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

app.use('/api', generalLimiter);

// ============================================================================
// ROUTES
// ============================================================================

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/events', eventsRouter);
app.use('/api/venues', venuesRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/users', usersRouter);

// ============================================================================
// IMAGE PROXY
// ============================================================================

const IMAGE_EXTENSION_PATTERN = /\.(jpg|jpeg|png|webp|gif)$/i;

app.get('/api/images/proxy', imageLimiter, async (req: Request, res: Response) => {
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

  // ---- 1. Local cache -------------------------------------------------
  const cacheDir = shortcode ? resolveCacheDir(BLEAD_IMAGES_PATH, shortcode) : null;

  if (cacheDir && existsSync(cacheDir)) {
    try {
      const fileList = readdirSync(cacheDir).filter(name => IMAGE_EXTENSION_PATTERN.test(name));
      if (fileList.length > 0) {
        const filePath = join(cacheDir, fileList[0]);
        res.setHeader('Content-Type', contentTypeForFile(fileList[0]));
        res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days

        const stream = createReadStream(filePath);
        // Without this listener a read error after headers are sent
        // becomes an uncaught exception and takes the process down.
        stream.on('error', (err) => {
          console.error('Image cache read failed:', err);
          if (!res.headersSent) res.status(500).json({ error: 'Image read failed' });
          else res.destroy();
        });
        stream.pipe(res);
        return;
      }
    } catch (err) {
      console.error('Image cache scan failed:', err);
      // Fall through to the CDN.
    }
  }

  // ---- 2. CDN ---------------------------------------------------------
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const cdnResponse = await fetch(checked.url, {
      signal: controller.signal,
      // Manual: an allowlisted host could otherwise redirect the proxy
      // into the internal network, re-opening the SSRF from one step out.
      redirect: 'manual',
      headers: { accept: 'image/*' },
    });
    clearTimeout(timeout);

    if (!cdnResponse.ok) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    const contentType = safeContentType(cdnResponse.headers.get('content-type'));
    if (!contentType) {
      res.status(415).json({ error: 'Unsupported image type' });
      return;
    }

    // Reject on the declared length before downloading anything.
    const declaredLength = Number(cdnResponse.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTE) {
      res.status(413).json({ error: 'Image too large' });
      return;
    }

    const buffer = Buffer.from(await cdnResponse.arrayBuffer());
    // And again on the actual size — content-length may be absent or lie.
    if (buffer.byteLength > MAX_IMAGE_BYTE) {
      res.status(413).json({ error: 'Image too large' });
      return;
    }

    // Populate the cache so the next request skips the network entirely.
    // The previous version never wrote back, so every miss re-fetched
    // from Instagram forever.
    if (cacheDir) {
      try {
        mkdirSync(cacheDir, { recursive: true });
        const extension = contentType.split('/')[1].replace('jpeg', 'jpg');
        writeFileSync(join(cacheDir, `${shortcode}.${extension}`), buffer);
      } catch (err) {
        console.error('Image cache write failed:', err);
      }
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
    res.send(buffer);
    return;
  } catch {
    // Timeout, DNS failure, or connection reset.
  }

  res.status(404).json({ error: 'Image not found' });
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Liveness plus dependency check.
 *
 * This previously returned `{status:'ok'}` without touching anything, so
 * it stayed green while Postgres was down and while the ingest had been
 * dead for months. A health check that cannot fail is not a health check.
 */
app.get('/api/health', async (_req: Request, res: Response) => {
  const checkedAt = new Date().toISOString();

  try {
    await sql`SELECT 1`;
  } catch (err) {
    console.error('Health check: database unreachable', err);
    res.status(503).json({ status: 'error', database: 'unreachable', checked_at: checkedAt });
    return;
  }

  // Ingest freshness. Stale data is not fatal — the API still serves —
  // but it is the signal whose absence let this product go quiet for
  // four months without anyone noticing.
  let lastSyncAt: string | null = null;
  let isIngestStale = true;
  try {
    const row = await sql<{ completed_at: Date | null }[]>`
      SELECT completed_at
      FROM sync_log
      WHERE status = 'completed'
      ORDER BY completed_at DESC NULLS LAST
      LIMIT 1
    `;
    const completedAt = row[0]?.completed_at ?? null;
    if (completedAt) {
      lastSyncAt = completedAt.toISOString();
      isIngestStale = Date.now() - completedAt.getTime() > 24 * 60 * 60 * 1000;
    }
  } catch (err) {
    console.error('Health check: sync_log unreadable', err);
  }

  res.json({
    status: isIngestStale ? 'degraded' : 'ok',
    database: 'ok',
    ingest: { last_sync_at: lastSyncAt, is_stale: isIngestStale },
    checked_at: checkedAt,
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

/** Unmatched API paths returned Express's HTML 404 to a JSON client. */
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

/**
 * Terminal error handler. There was none, so anything thrown outside a
 * route's own try/catch fell through to Express's default handler — which
 * answers with HTML and, outside production, a stack trace.
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================================
// START SERVER
// ============================================================================

const server = app.listen(PORT, () => {
  console.log(`\n🎉 WheresTheFX API on http://localhost:${PORT}`);
  console.log(`   Env:         ${IS_PRODUCTION ? 'production' : 'development'}`);
  console.log(`   CORS:        ${allowedOrigin.length ? allowedOrigin.join(', ') : '(none configured)'}${IS_PRODUCTION ? '' : ' + localhost'}`);
  console.log(`   Image cache: ${BLEAD_IMAGES_PATH || '(not configured)'}\n`);
});

/**
 * Graceful shutdown. The listener handle was previously discarded, so
 * every PM2 restart killed in-flight requests and leaked PG connections
 * until the pool timed out.
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received, draining...`);

  const forceExit = setTimeout(() => {
    console.error('Drain timed out, exiting.');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async () => {
    try {
      await sql.end({ timeout: 5 });
    } catch (err) {
      console.error('Error closing database pool:', err);
    }
    console.log('Shutdown complete.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  void shutdown('uncaughtException');
});

export default app;
