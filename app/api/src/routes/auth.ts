/**
 * Auth Routes — Account registration and login
 *
 * Provides JWT-based authentication endpoints.
 * Passwords are hashed with bcrypt (10 salt rounds).
 * Tokens expire in 7 days.
 *
 * ## Endpoints
 * - POST /api/auth/register — Create new account
 * - POST /api/auth/login    — Login with email + password
 * - GET  /api/users/me      — Get current account profile (auth required)
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '@wheresthefx/db';
import { account, accountPreference } from '@wheresthefx/db';
import { eq } from 'drizzle-orm';
import { authenticate, generateToken } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

/** Validation schema for registration */
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  username: z.string().min(3, 'Username must be at least 3 characters').max(50),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  displayName: z.string().optional(),
});

/** Validation schema for login */
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

/**
 * POST /api/auth/register
 *
 * Create a new account. Returns a JWT token on success.
 * Also creates an empty account_preference row for the new account.
 *
 * Request body: { email, username, password, displayName? }
 * Response: { token, user: { id, email, username, displayName } }
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const data = registerSchema.parse(req.body);

    // Check if email or username already exists
    const existing = await db.query.account.findFirst({
      where: (u, { or, eq: e }) => or(e(u.email, data.email), e(u.username, data.username)),
    });

    if (existing) {
      res.status(409).json({
        error: existing.email === data.email
          ? 'Email already registered'
          : 'Username already taken',
      });
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 10);

    // Insert account
    const [user] = await db.insert(account).values({
      email: data.email,
      username: data.username,
      passwordHash,
      displayName: data.displayName,
    }).returning();

    // Create empty preferences
    await db.insert(accountPreference).values({
      accountId: user.id,
      preferredCategories: [],
    });

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      username: user.username,
    });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
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

    // Find account by email
    const user = await db.query.account.findFirst({
      where: eq(account.email, data.email),
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Verify password
    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      username: user.username,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * GET /api/users/me
 *
 * Get the current authenticated account's profile.
 * Requires a valid Bearer token.
 *
 * Response: { id, email, username, displayName, preferences }
 */
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await db.query.account.findFirst({
      where: eq(account.id, req.user!.userId),
      with: {
        preference: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      preferences: user.preference?.preferredCategories || [],
    });
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

export default router;
