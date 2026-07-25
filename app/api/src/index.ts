/**
 * WheresTheFX — Express Server Entry Point
 *
 * This is the main server file that:
 * 1. Configures Express with CORS and JSON parsing
 * 2. Mounts all API route modules
 * 3. Provides an image proxy endpoint for expired IG CDN URLs
 * 4. Starts listening on the configured port
 *
 * ## Route Structure
 *
 * | Path               | Router         | Description              |
 * |--------------------|----------------|--------------------------|
 * | /api/events        | events.ts      | Event discovery & detail |
 * | /api/venues        | venues.ts      | Venue directory          |
 * | /api/categories    | categories.ts  | Category metadata        |
 * | /api/auth          | auth.ts        | Registration & login     |
 * | /api/users/me      | auth.ts + users.ts | Profile & saved events |
 * | /api/images/proxy  | (inline)       | Image proxy / cache      |
 *
 * ## Image Proxy
 *
 * Instagram CDN URLs expire after some time. The image proxy:
 * 1. Tries to fetch the original CDN URL
 * 2. If it fails (403/404), looks for a locally cached copy
 *    at BLEAD_IMAGES_PATH/{shortcode}/
 * 3. Returns the image with appropriate cache headers
 *
 * Frontend references images as: /api/images/proxy?url=<encoded_url>&shortcode=<code>
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { existsSync, readdirSync, createReadStream } from 'fs';
import { join } from 'path';

import eventsRouter from './routes/events.js';
import venuesRouter from './routes/venues.js';
import categoriesRouter from './routes/categories.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import { snakeCaseResponse } from './middleware/snakeCase.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');
const BLEAD_IMAGES_PATH = process.env.BLEAD_IMAGES_PATH || '';

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Allow any localhost in dev, and production origins from CORS_ORIGIN (comma-separated)
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : [];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
      callback(null, true);
    } else if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(snakeCaseResponse);

// ============================================================================
// ROUTES
// ============================================================================

app.use('/api/events', eventsRouter);
app.use('/api/venues', venuesRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);

// ============================================================================
// IMAGE PROXY
// ============================================================================

/**
 * GET /api/images/proxy
 *
 * Proxies Instagram event images. Tries CDN first, falls back to
 * blead's local cache if the CDN URL has expired.
 *
 * Query params:
 * - url: The Instagram CDN URL to proxy
 * - shortcode: The IG post shortcode (for local cache fallback)
 *
 * Why this exists:
 * Instagram CDN URLs (https://instagram.fmnl4-6.fna.fbcdn.net/...)
 * expire after a few days. blead caches images locally in
 * data/ig-images/{shortcode}/ but those are on the VPS filesystem.
 * This proxy fetches from CDN first, falling back to local cache.
 */
app.get('/api/images/proxy', async (req, res) => {
  try {
    const { url, shortcode } = req.query as { url?: string; shortcode?: string };

    if (!url) {
      res.status(400).json({ error: 'URL parameter required' });
      return;
    }

    // Try local cache FIRST — instant, no network.
    // Most CDN URLs are expired so checking them first just adds latency.
    if (shortcode && BLEAD_IMAGES_PATH) {
      const cacheDir = join(BLEAD_IMAGES_PATH, shortcode);
      if (existsSync(cacheDir)) {
        const files = readdirSync(cacheDir).filter(f =>
          /\.(jpg|jpeg|png|webp)$/i.test(f)
        );
        if (files.length > 0) {
          const filePath = join(cacheDir, files[0]);
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
          createReadStream(filePath).pipe(res);
          return;
        }
      }
    }

    // Fallback: try CDN (may still work for recent posts)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const cdnResponse = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (cdnResponse.ok) {
        const contentType = cdnResponse.headers.get('content-type') || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const buffer = Buffer.from(await cdnResponse.arrayBuffer());
        res.send(buffer);
        return;
      }
    } catch {
      // CDN failed or timed out
    }

    // Both failed
    res.status(404).json({ error: 'Image not found' });
  } catch (err) {
    console.error('Image proxy error:', err);
    res.status(500).json({ error: 'Image proxy failed' });
  }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`\n🎉 WheresTheFX server running on http://localhost:${PORT}`);
  console.log(`   CORS: any localhost origin`);
  console.log(`   Image cache: ${BLEAD_IMAGES_PATH || '(not configured)'}\n`);
});

export default app;
