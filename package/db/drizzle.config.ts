import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema.ts',
  out: './migration',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/wheresthefx',
  },
} satisfies Config;
