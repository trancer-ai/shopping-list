// server/db.js
import Database from 'better-sqlite3';

export const CATEGORIES = [
  'F&V', 'Meat', 'Deli', 'Bakery', 'General Food', 'Personal', 'Cleaning', 'Cold Things'
];
export const isValidCategory = (c) => CATEGORIES.includes(c);

export function openDb(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');

  // Create table with the snake_case schema the server expects
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id TEXT NOT NULL,
      name TEXT NOT NULL,
      qty TEXT,
      note TEXT,
      category TEXT DEFAULT 'General Food',
      position INTEGER NOT NULL,
      is_checked INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_items_list ON items(list_id);
    CREATE INDEX IF NOT EXISTS idx_items_position ON items(list_id, position);
    CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at);
  `);

  return db;
}
