/**
 * Puts the WhatsApp template library (lib/services/template-library.ts) into every gym.
 *
 *   npm run db:templates                      add the library; nothing is deleted
 *   npm run db:templates -- --replace-all     delete every other template first (a backup is saved)
 *   npm run db:templates -- --keep-approved   delete the others, except ones already sent to WhatsApp (pending or approved)
 *
 * Messages that used a deleted template stay in the history. Templates already approved by WhatsApp stay on
 * WhatsApp; only the copy in GymPilot is removed. The library's own templates are never deleted.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { installTemplateLibrary, TEMPLATE_LIBRARY } from '../lib/services/template-library';

async function main() {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('USER:PASSWORD')) {
    console.error('Paste your Neon connection string into DATABASE_URL in the .env file first.');
    process.exit(1);
  }
  const replaceAll = process.argv.includes('--replace-all');
  const keepApproved = process.argv.includes('--keep-approved');
  if (replaceAll && keepApproved) throw new Error('Choose either --replace-all or --keep-approved, not both');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const keys = TEMPLATE_LIBRARY.map((t) => t.key);
    if (replaceAll || keepApproved) {
      const doomed = (await client.query(
        `SELECT * FROM message_templates WHERE (key IS NULL OR NOT key = ANY($1)) ${keepApproved ? `AND wa_template_id IS NULL` : ''} ORDER BY gym_id, id`, [keys])).rows;
      const dir = join(process.cwd(), '.backups');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `templates-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      writeFileSync(file, JSON.stringify(doomed, null, 2));
      console.log(`Saved a copy of ${doomed.length} templates to ${file}`);
      const del = await client.query(
        `DELETE FROM message_templates WHERE (key IS NULL OR NOT key = ANY($1)) ${keepApproved ? `AND wa_template_id IS NULL` : ''}`, [keys]);
      console.log(`Deleted ${del.rowCount} templates`);
    }
    const gyms = (await client.query('SELECT id FROM gyms ORDER BY id')).rows as { id: number }[];
    for (const g of gyms) console.log(`Gym ${g.id}: added ${await installTemplateLibrary(client, g.id)} templates`);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error('Template setup failed:', e.message); process.exit(1); });
