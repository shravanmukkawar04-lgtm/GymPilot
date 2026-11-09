import { Client } from 'pg';

/** Deletes ALL data. Only runs with: npm run db:reset -- --yes */
async function main() {
  if (!process.argv.includes('--yes')) {
    console.error('This deletes ALL gym data. To confirm, run: npm run db:reset -- --yes');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
  console.log('All data deleted. Run "npm run db:setup" to recreate the tables.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
