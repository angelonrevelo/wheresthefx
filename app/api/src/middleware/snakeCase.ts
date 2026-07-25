/**
 * Snake Case Response Middleware
 *
 * Intercepts Express JSON responses and transforms all keys from
 * camelCase to snake_case before sending. This ensures API responses
 * follow the convention of snake_case keys while allowing Drizzle ORM
 * to use its default camelCase JS property mapping internally.
 *
 * Usage: app.use(snakeCaseResponse) — place before routes.
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Convert a camelCase string to snake_case.
 * e.g., "eventDate" → "event_date", "venueLat" → "venue_lat"
 */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Recursively transform all object keys from camelCase to snake_case.
 * Handles nested objects and arrays.
 */
function transformKeys(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(transformKeys);
  if (typeof obj !== 'object' || obj instanceof Date) return obj;

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toSnakeCase(key)] = transformKeys(value);
  }
  return result;
}

/**
 * Express middleware that wraps res.json() to auto-convert
 * all response keys from camelCase to snake_case.
 */
export function snakeCaseResponse(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);

  res.json = function (body: any) {
    return originalJson(transformKeys(body));
  };

  next();
}
