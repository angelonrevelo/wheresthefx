/**
 * Auth Routes — Account registration and login
 *
 * Provides JWT-based authentication endpoints.
 * Passwords are hashed with bcrypt (12 salt rounds).
 * Tokens expire in 7 days.
 *
 * ## Endpoints
 * - POST /api/auth/register — Create new account
 * - POST /api/auth/login    — Login with email + password
 * - GET  /api/auth/me       — Get current account profile (auth required)
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, generateToken } from '../middleware/auth.js';
import { createAccount, findAccountByEmail, findAccountProfile } from '../db/account.js';
import { z } from 'zod';

const router = Router();

/** Validation schema for registration */
const registerSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  username: z.string().min(3, 'Username must be at least 3 characters').max(50),
  // bcrypt silently truncates at 72 bytes, so anything past that is a lie
  // about how strong the password is. Bounded explicitly.
  password: z.string()
    .min(10, 'Password must be at least 10 characters')
    .max(72, 'Password must be at most 72 characters'),
  display_name: z.string().max(100).optional(),
});

/** Validation schema for login */
const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().max(72),
});

/**
 * A valid bcrypt hash of a value no user can supply.
 *
 * Login used to return 401 immediately when the email was unknown,
 * skipping bcrypt entirely. That ~100ms difference made the whole user
 * table enumerable by timing alone. Comparing against this dummy keeps
 * the unknown-email path the same cost as the wrong-password path.
 */
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

/** Narrow a zod failure to a single, client-usable message. */
function zodMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid request body';
}

/** PostgreSQL unique-violation. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
}

/**
 * POST /api/auth/register
 *
 * Create a new account. Returns a JWT token on success.
 * Also creates an empty account_preference row for the new account.
 *
 * Request body: { email, username, password, display_name? }
 * Response: { token, user: { id, email, username, displayName } }
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const data = registerSchema.parse(req.body);
    const email = data.email.trim().toLowerCase();

    const passwordHash = await bcrypt.hash(data.password, 12);

    // Account and preference are created together: previously they were
    // two autocommit statements, so a failure between them left an
    // account with no preference row.
    const user = await createAccount({
      email,
      username: data.username,
      passwordHash,
      displayName: data.display_name,
    });

    const token = generateToken({
      userId: user.accountId,
      email: user.email,
      username: user.username,
    });

    res.status(201).json({
      token,
      user: {
        id: user.accountId,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: zodMessage(err) });
      return;
    }

    // Uniqueness is enforced by the database rather than by a prior
    // SELECT. The check-then-insert version had a race that turned two
    // concurrent signups into a 500, and its distinct "email taken" vs
    // "username taken" messages made the user table enumerable. One
    // message, both cases.
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'Those credentials are not available' });
      return;
    }

    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * POST /api/auth/login
 *
 * Authenticate with email and password. Returns a JWT token.
 *
 * Request body: { email, password }
 * Response: { token, user: { id, email, username, displayName } }
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const data = loginSchema.parse(req.body);
    const email = data.email.trim().toLowerCase();

    const user = await findAccountByEmail(email);

    // bcrypt.compare runs on every path, including the unknown-email one,
    // so response time does not reveal whether the account exists.
    const isValid = await bcrypt.compare(data.password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !isValid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Generate token
    const token = generateToken({
      userId: user.accountId,
      email: user.email,
      username: user.username,
    });

    res.json({
      token,
      user: {
        id: user.accountId,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: zodMessage(err) });
      return;
    }
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * GET /api/auth/me
 *
 * Get the current authenticated account's profile.
 * Requires a valid Bearer token.
 *
 * Response: { id, email, username, displayName, preference }
 */
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await findAccountProfile(req.user!.userId);

    if (!user) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    res.json({
      id: user.accountId,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      preference: user.preference?.preferredCategory ?? [],
    });
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

export default router;
