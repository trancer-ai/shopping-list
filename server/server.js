import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { openDb } from './db.js';

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
const normalize = (r) => ({
  id: r.id,
  listId: r.listId,
  name: r.name,
  qty: r.qty ?? '',
  note: r.note ?? '',
  isChecked: !!r.isChecked,
  position: r.position,
  updatedAt: r.updatedAt
});

// Health
app.get('/api/health', (_, res) => res.json({ ok: true }));

// List items for a listId
app.get('/api/lists/:listId/items', (req, res) => {
  const listId = req.params.listId || 'default';
  const rows = db.prepare('SELECT * FROM items WHERE listId = ? ORDER BY position ASC, id ASC').all(listId);
  res.json(rows.map(normalize));
});

// Add item
app.post('/api/items', (req, res) => {
  const { listId = 'default', name, qty = '', note = '' } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
  const last = db.prepare('SELECT COALESCE(MAX(position), 0) as maxPos FROM items WHERE listId = ?').get(listId);
  const position = (last?.maxPos || 0) + 1;
  const updatedAt = nowIso();
  const info = db.prepare('INSERT INTO items (listId, name, qty, note, isChecked, position, updatedAt) VALUES (?, ?, ?, ?, 0, ?, ?)')
    .run(listId, name.trim(), qty, note, position, updatedAt);
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(normalize(row));
});

// Update item
app.patch('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const { name, qty, note, isChecked, position } = req.body || {};
  const updatedAt = nowIso();
  const fields = [];
  const values = [];
  if (typeof name === 'string') { fields.push('name = ?'); values.push(name.trim()); }
  if (typeof qty === 'string') { fields.push('qty = ?'); values.push(qty); }
  if (typeof note === 'string') { fields.push('note = ?'); values.push(note); }
  if (typeof isChecked === 'boolean') { fields.push('isChecked = ?'); values.push(isChecked ? 1 : 0); }
  if (typeof position === 'number') { fields.push('position = ?'); values.push(position); }
  fields.push('updatedAt = ?'); values.push(updatedAt);
  if (fields.length === 1) return res.status(400).json({ error: 'no changes' });

  const sql = `UPDATE items SET ${fields.join(', ')} WHERE id = ?`;
  values.push(id);
  db.prepare(sql).run(values);

  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  res.json(normalize(row));
});

// Delete item
app.delete('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  const info = db.prepare('DELETE FROM items WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

// Serve client build (Docker copies Vite build here)
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Shopping List server listening on http://localhost:${PORT}`);
});