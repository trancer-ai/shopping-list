// Run once when upgrading an existing installation:
//   DATABASE_URL=postgres://... node scripts/migrateFromSqlite.js /path/to/old/app.db
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db/pool.js';
import { migrate, DEFAULT_HOUSEHOLD_NAME } from '../src/db/migrate.js';

const sqlitePath = process.argv[2];
if (!sqlitePath) {
  console.error('Usage: node scripts/migrateFromSqlite.js /path/to/old/app.db');
  process.exit(1);
}

async function run() {
  const householdId = await migrate();
  const sqlite = new Database(sqlitePath, { readonly: true });
  const rows = sqlite.prepare('SELECT * FROM items ORDER BY position ASC, id ASC').all();

  console.log(`Migrating ${rows.length} item(s) into household ${DEFAULT_HOUSEHOLD_NAME} (${householdId})`);

  for (const row of rows) {
    await pool.query(
      `INSERT INTO items (id, household_id, name, qty, note, category, is_checked, position, version, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)`,
      [
        randomUUID(),
        householdId,
        row.name,
        row.qty || '',
        row.note || '',
        row.category || 'General Food',
        !!row.is_checked,
        row.position,
        row.updated_at
      ]
    );
  }

  console.log('Migration complete.');
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
