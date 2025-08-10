import Database from 'better-sqlite3';

export function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listId TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      qty TEXT,
      note TEXT,
      isChecked INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_list_position ON items(listId, position);
  `);
  return db;
}