import { createDb } from '@khal/db';
import { env } from './env.ts';

export const db = createDb(env.databaseUrl);
export type { Db } from '@khal/db';
export * from '@khal/db';
