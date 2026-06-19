import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

const url = process.env.KHAL_DATABASE_URL ?? 'postgresql://postgres@localhost:8432/omni';

const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client);

await db.execute('CREATE SCHEMA IF NOT EXISTS khal');
await migrate(db, { migrationsFolder: './drizzle', migrationsSchema: 'khal' });

console.log('migrations: done');
await client.end();
