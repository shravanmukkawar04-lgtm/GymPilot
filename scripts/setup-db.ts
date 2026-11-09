import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

async function main() {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('USER:PASSWORD')) {
    console.error('Paste your Neon connection string into DATABASE_URL in the .env file first.');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf8'));
  await client.end();
  console.log('Database is ready.');
}

main().catch((e) => { console.error('Database setup failed:', e.message); process.exit(1); });
