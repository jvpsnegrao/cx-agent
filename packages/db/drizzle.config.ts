import { defineConfig } from 'drizzle-kit';

const url = process.env.KHAL_DATABASE_URL ?? 'postgresql://postgres@localhost:8432/omni';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  schemaFilter: ['khal'],
  verbose: true,
  strict: true,
});
