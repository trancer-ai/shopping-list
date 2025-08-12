import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { openDb, CATEGORIES, isValidCategory } from './db.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'app.db');
const NODE_ENV = process.env.NODE_ENV || 'production';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';

const db = openDb(DB_PATH);
const app = express();

app.use(morgan('dev'));
app.use(express.json());

if (NODE_ENV !== 'production' && CORS_ORIGIN) {
  app.use(cors({ origin: CORS_ORIGIN }));
}

const nowIso = () => new Date().toISOString();

// Map DB row (snake_case) -> API (camelCase)
const normalize = (r) => ({
  id: r.id,
  listId: r.list_id,
  name: r.name,
  qty: r.qty ?? '',
  note: r.note ?? '',
  category: r.category ?? 'General Food',
  isChecked: !!r.is_checked,
  position: r.position,
  updatedAt: r.updated_at
});

// ---------- Health ----------
app.get('/api/health', (_, res) => res.json({ ok: true }));

// ---------- List items ----------
app.get('/api/lists/:listId/items', (req, res) => {
  const listId = req.params.listId || 'default';
  const sort = (req.query.sort || '').toString();

  // Optional sort modes: category | alpha | recent | (default: position)
  let rows;
  if (sort === 'alpha') {
    rows = db.prepare(
      `SELECT * FROM items WHERE list_id = ? ORDER BY name COLLATE NOCASE ASC, id ASC`
    ).all(listId);
  } else if (sort === 'recent') {
    rows = db.prepare(
      `SELECT * FROM items WHERE list_id = ? ORDER BY updated_at DESC, id DESC`
    ).all(listId);
  } else if (sort === 'category') {
    // Order categories by our fixed list, then by name
    const orderCases = CATEGORIES.map((c, i) => `WHEN '${c}' THEN ${i}`).join(' ');
    rows = db.prepare(
      `
      SELECT * FROM items
      WHERE list_id = ?
      ORDER BY CASE category ${orderCases} ELSE ${CATEGORIES.length} END ASC,
               name COLLATE NOCASE ASC
      `
    ).all(listId);
  } else {
    // default: position
    rows = db.prepare(
      `SELECT * FROM items WHERE list_id = ? ORDER BY position ASC, id ASC`
    ).all(listId);
  }

  res.json(rows.map(normalize));
});

// ---------- Add item ----------
app.post('/api/items', (req, res) => {
  const { listId, name, qty, note, category } = req.body || {};
  if (!listId || !name) return res.status(400).json({ error: 'listId and name required' });

  const cat = isValidCategory(category) ? category : 'General Food';
  const position = (db.prepare(
    `SELECT IFNULL(MAX(position), 0) AS maxp FROM items WHERE list_id = ?`
  ).get(listId)?.maxp || 0) + 1;

  const updatedAt = nowIso();
  const info = db.prepare(
    `
    INSERT INTO items (list_id, name, qty, note, category, position, is_checked, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `
  ).run(listId, name.trim(), qty || '', note || '', cat, position, updatedAt);

  const row = db.prepare(`SELECT * FROM items WHERE id = ?`).get(info.lastInsertRowid);
  res.json(normalize(row));
});

// ---------- Update item (PUT) ----------
app.put('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const { name, qty, note, isChecked, position, category } = req.body || {};

  const fields = [];
  const values = [];

  if (typeof name === 'string') { fields.push('name = ?'); values.push(name.trim()); }
  if (typeof qty === 'string') { fields.push('qty = ?'); values.push(qty); }
  if (typeof note === 'string') { fields.push('note = ?'); values.push(note); }
  if (typeof isChecked === 'boolean') { fields.push('is_checked = ?'); values.push(isChecked ? 1 : 0); }
  if (typeof position === 'number') { fields.push('position = ?'); values.push(position); }
  if (typeof category === 'string' && isValidCategory(category)) {
    fields.push('category = ?'); values.push(category);
  }

  // Always bump updated_at if anything changed
  if (fields.length === 0) {
    // nothing to change; return current
    return res.json(normalize(existing));
  }
  fields.push('updated_at = ?'); values.push(nowIso());

  const sql = `UPDATE items SET ${fields.join(', ')} WHERE id = ?`;
  values.push(id);
  db.prepare(sql).run(...values); // <-- spread values

  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  res.json(normalize(row));
});

// (Keep your PATCH route too, if you want partial updates)
app.patch('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const { name, qty, note, isChecked, position, category } = req.body || {};
  const fields = [];
  const values = [];

  if (typeof name === 'string') { fields.push('name = ?'); values.push(name.trim()); }
  if (typeof qty === 'string') { fields.push('qty = ?'); values.push(qty); }
  if (typeof note === 'string') { fields.push('note = ?'); values.push(note); }
  if (typeof isChecked === 'boolean') { fields.push('is_checked = ?'); values.push(isChecked ? 1 : 0); }
  if (typeof position === 'number') { fields.push('position = ?'); values.push(position); }
  if (typeof category === 'string' && isValidCategory(category)) {
    fields.push('category = ?'); values.push(category);
  }
  if (fields.length === 0) return res.status(400).json({ error: 'no changes' });

  fields.push('updated_at = ?'); values.push(nowIso());

  const sql = `UPDATE items SET ${fields.join(', ')} WHERE id = ?`;
  values.push(id);
  db.prepare(sql).run(...values);

  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  res.json(normalize(row));
});

// ---------- Delete item ----------
app.delete('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  const info = db.prepare('DELETE FROM items WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

// ---------- Serve client build ----------
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Shopping List server listening on http://localhost:${PORT}`);
});
