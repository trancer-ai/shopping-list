import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_HOUSEHOLD_NAME = 'My Household';

export async function migrate() {
  const schema = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  // Atomic upsert: insert if not exists, return id either way
  const { rows: upsertRows } = await pool.query(
    'INSERT INTO households (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id',
    [DEFAULT_HOUSEHOLD_NAME]
  );
  if (upsertRows.length > 0) return upsertRows[0].id;

  // If upsert returned no row, the household already existed; fetch it
  const { rows: existingRows } = await pool.query(
    'SELECT id FROM households WHERE name = $1',
    [DEFAULT_HOUSEHOLD_NAME]
  );
  return existingRows[0].id;
}
