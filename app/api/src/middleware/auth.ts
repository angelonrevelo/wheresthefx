/**
 * Auth Middleware — JWT verification for Express
 *
 * Provides two middleware functions:
 * - `authenticate`: Required auth — returns 401 if no valid token
 * - `optionalAuth`: Optional auth — attaches user if token present, continues if not
 *
 * ## How It Works
 *
 * 1. Client sends `Authorization: Bearer <token>` header
 * 2. Middleware extracts and verifies the JWT using JWT_SECRET
 * 3. If valid, attaches `req.user` with `{ userId, email, username }`
 * 4. If invalid/missing: `authenticate` returns 401, `optionalAuth` continues
 *
 * ## Usage
 * ```ts
 * // Protected route
 * router.get('/me', authenticate, (req, res) => {
 *   res.json(req.user);
 * });
 *
 * // Optional auth (e.g., to show "saved" badge if logged in)
 * router.get('/events', optionalAuth, (req, res) => {
 *   const userId = req.user?.userId; // may be undefined
 * });
 * ```
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/** Shape of the decoded JWT payload attached to req.user */
export interface AuthPayload {
  userId: number;
  email: string;
  username: string;
}

// Extend Express Request to include the user property.
// Module augmentation of Express's types requires `namespace`; there is
// no ES-module equivalent, so the rule is disabled for this block only.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/**
 * Signing secret.
 *
 * This previously fell back to the literal `'change-me'`. That default is
 * published in this repository, so any deployment missing the env var
 * issued tokens that anyone reading the source could forge. There is no
 * safe default for a signing key — fail loudly at startup instead.
 */
function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is required. ' +
      'Generate one with: openssl rand -base64 48',
    );
  }
  // A short secret is brute-forceable offline once any token leaks.
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters.');
  }
  return secret;
}

const JWT_SECRET = requireJwtSecret();

/**
 * Required authentication middleware.
 * Returns 401 if no valid Bearer token is present.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Optional authentication middleware.
 * Attaches user info if a valid token is present, but doesn't reject
 * the request if there's no token. Useful for endpoints that show
 * different data to logged-in vs anonymous users.
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AuthPayload;
      req.user = payload;
    } catch {
      // Invalid token — just continue without user
    }
  }

  next();
}

/**
 * Generate a JWT token for a user.
 * Used during login and registration.
 *
 * @param payload - User data to encode in the token
 * @returns Signed JWT string (expires in 7 days)
 */
export function generateToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });
}
