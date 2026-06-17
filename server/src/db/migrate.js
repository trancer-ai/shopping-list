import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_HOUSEHOLD_NAME = 'My Household';

export async function migrate() {
  const schema = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  const { rows } = await pool.query(
    'SELECT id FROM households WHERE name = $1 LIMIT 1',
    [DEFAULT_HOUSEHOLD_NAME]
  );
  if (rows.length > 0) return rows[0].id;

  const inserted = await pool.query(
    'INSERT INTO households (name) VALUES ($1) RETURNING id',
    [DEFAULT_HOUSEHOLD_NAME]
  );
  return inserted.rows[0].id;
}
