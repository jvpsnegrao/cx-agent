import { createDb } from '@khal/db';

const url = process.env.KHAL_DATABASE_URL;
if (!url) {
  throw new Error('KHAL_DATABASE_URL não setado');
}

export const db = createDb(url);
export type DbClient = typeof db;
