# Multi-User Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shopping list app handle concurrent household editing correctly (no duplicate entries, no silently lost edits, live updates without manual refresh) while reshaping the data model so real user accounts can be added later without a rewrite.

**Architecture:** Single Express process restructured into routes/services/repository layers, backed by PostgreSQL instead of SQLite. Client generates permanent UUIDs and idempotency keys for every write (eliminating today's temp-ID remap bug), the server enforces optimistic-concurrency via a `version` column, and a WebSocket channel broadcasts writes to other connected clients for live updates. The existing offline IndexedDB cache and localStorage queue are kept, just made idempotent.

**Tech Stack:** Node.js, Express, `pg` (PostgreSQL driver), `ws` (WebSocket), `better-sqlite3` (migration script only), React (existing), `idb` (existing), Node's built-in `node:test` runner for new tests.

Reference spec: `.context/2026-06-17-multiuser-modernization-design.md`

---

## Task 1: Add PostgreSQL to Docker Compose and server config

**Files:**
- Modify: `docker-compose.yml`
- Modify: `server/.env.example`
- Modify: `server/package.json`

- [ ] **Step 1: Add a `postgres` service and a named volume to `docker-compose.yml`**

Replace the contents of `docker-compose.yml` with:

```yaml
version: "3.9"

services:
  shoppinglist:
    image: ghcr.io/trancer-ai/shopping-list:latest
    container_name: shoppinglist
    restart: unless-stopped
    depends_on:
      - postgres
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATABASE_URL=postgres://shoppinglist:shoppinglist@postgres:5432/shoppinglist
    networks:
      - external_net
    # No ports published — access only via reverse proxy
    # If you want LAN access as well, uncomment below:
    # ports:
    #   - "3000:3000"

  postgres:
    image: postgres:16-alpine
    container_name: shoppinglist-db
    restart: unless-stopped
    environment:
      - POSTGRES_USER=shoppinglist
      - POSTGRES_PASSWORD=shoppinglist
      - POSTGRES_DB=shoppinglist
    volumes:
      - shoppinglist-db-data:/var/lib/postgresql/data
    networks:
      - external_net

networks:
  external_net:
    external: true
    name: External

volumes:
  shoppinglist-db-data:
```

- [ ] **Step 2: Update `server/.env.example` to use `DATABASE_URL` instead of `DB_PATH`**

```
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
DATABASE_URL=postgres://shoppinglist:shoppinglist@localhost:5432/shoppinglist
```

- [ ] **Step 3: Add `pg` and `ws` dependencies, keep `better-sqlite3` as a dev dependency for the migration script**

Edit `server/package.json` so `dependencies` and `devDependencies` read:

```json
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.2",
    "morgan": "^1.10.0",
    "pg": "^8.13.1",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "better-sqlite3": "^9.6.0"
  }
```

- [ ] **Step 4: Install dependencies**

Run: `cd server && npm install`
Expected: `pg`, `ws` added to `dependencies`, `better-sqlite3` moved to `devDependencies`, lockfile updated.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml server/.env.example server/package.json server/package-lock.json
git commit -m "infra: add PostgreSQL service and pg/ws dependencies"
```

---

## Task 2: PostgreSQL schema and connection pool

**Files:**
- Create: `server/src/db/schema.sql`
- Create: `server/src/db/pool.js`
- Create: `server/src/db/migrate.js`

- [ ] **Step 1: Write the schema**

Create `server/src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS household_members (
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (household_id, user_id)
);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  name TEXT NOT NULL,
  qty TEXT DEFAULT '',
  note TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT 'General Food',
  is_checked BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_items_household ON items(household_id);
CREATE INDEX IF NOT EXISTS idx_items_household_position ON items(household_id, position);
CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at);
```

- [ ] **Step 2: Write the connection pool module**

Create `server/src/db/pool.js`:

```js
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

export const pool = new Pool({ connectionString: DATABASE_URL });
```

- [ ] **Step 3: Write the migration runner that applies the schema and seeds the default household**

Create `server/src/db/migrate.js`:

```js
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
```

- [ ] **Step 4: Verify manually against a local Postgres**

Run: `docker compose up -d postgres` then `cd server && DATABASE_URL=postgres://shoppinglist:shoppinglist@localhost:5432/shoppinglist node -e "import('./src/db/migrate.js').then(m => m.migrate()).then(id => console.log('seeded household', id))"`
Expected: prints `seeded household <uuid>` with no errors; running it twice prints the same id (idempotent seed).

- [ ] **Step 5: Commit**

```bash
git add server/src/db/schema.sql server/src/db/pool.js server/src/db/migrate.js
git commit -m "feat: add PostgreSQL schema and migration runner"
```

---

## Task 3: Items repository (data access layer)

**Files:**
- Create: `server/src/repositories/itemsRepository.js`

- [ ] **Step 1: Write the repository**

Create `server/src/repositories/itemsRepository.js`. This is the only file allowed to contain SQL for items.

```js
const CATEGORIES = [
  'F&V', 'Meat', 'Deli', 'Bakery', 'General Food', 'Personal', 'Cleaning', 'Cold Things', 'Utilities'
];
export const isValidCategory = (c) => CATEGORIES.includes(c);
export { CATEGORIES };

function normalize(r) {
  return {
    id: r.id,
    householdId: r.household_id,
    name: r.name,
    qty: r.qty ?? '',
    note: r.note ?? '',
    category: r.category ?? 'General Food',
    isChecked: r.is_checked,
    position: r.position,
    version: r.version,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at
  };
}

export function createItemsRepository(pool) {
  return {
    async list(householdId, sort) {
      let orderBy = 'position ASC, id ASC';
      if (sort === 'alpha') orderBy = 'name COLLATE "C" ASC, id ASC';
      else if (sort === 'recent') orderBy = 'updated_at DESC, id DESC';
      else if (sort === 'category') {
        const cases = CATEGORIES.map((c, i) => `WHEN '${c}' THEN ${i}`).join(' ');
        orderBy = `CASE category ${cases} ELSE ${CATEGORIES.length} END ASC, name COLLATE "C" ASC`;
      }
      const { rows } = await pool.query(
        `SELECT * FROM items WHERE household_id = $1 ORDER BY ${orderBy}`,
        [householdId]
      );
      return rows.map(normalize);
    },

    async getById(id) {
      const { rows } = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
      return rows[0] ? normalize(rows[0]) : null;
    },

    async insert({ id, householdId, name, qty, note, category }) {
      const cat = isValidCategory(category) ? category : 'General Food';
      const { rows: posRows } = await pool.query(
        'SELECT COALESCE(MAX(position), 0) AS maxp FROM items WHERE household_id = $1',
        [householdId]
      );
      const position = Number(posRows[0].maxp) + 1;
      const { rows } = await pool.query(
        `INSERT INTO items (id, household_id, name, qty, note, category, position, is_checked, version, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, 1, now())
         RETURNING *`,
        [id, householdId, name.trim(), qty || '', note || '', cat, position]
      );
      return normalize(rows[0]);
    },

    // Returns { conflict: true, current } if expectedVersion doesn't match,
    // otherwise { item: <updated row> }.
    async update(id, patch, expectedVersion) {
      const current = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
      if (current.rows.length === 0) return null;
      if (current.rows[0].version !== expectedVersion) {
        return { conflict: true, current: normalize(current.rows[0]) };
      }

      const fields = [];
      const values = [];
      let i = 1;
      if (typeof patch.name === 'string') { fields.push(`name = $${i++}`); values.push(patch.name.trim()); }
      if (typeof patch.qty === 'string') { fields.push(`qty = $${i++}`); values.push(patch.qty); }
      if (typeof patch.note === 'string') { fields.push(`note = $${i++}`); values.push(patch.note); }
      if (typeof patch.isChecked === 'boolean') { fields.push(`is_checked = $${i++}`); values.push(patch.isChecked); }
      if (typeof patch.position === 'number') { fields.push(`position = $${i++}`); values.push(patch.position); }
      if (typeof patch.category === 'string' && isValidCategory(patch.category)) {
        fields.push(`category = $${i++}`); values.push(patch.category);
      }
      if (fields.length === 0) return { item: normalize(current.rows[0]) };

      fields.push(`version = version + 1`);
      fields.push(`updated_at = now()`);
      const sql = `UPDATE items SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`;
      values.push(id);
      const { rows } = await pool.query(sql, values);
      return { item: normalize(rows[0]) };
    },

    async delete(id) {
      const { rowCount } = await pool.query('DELETE FROM items WHERE id = $1', [id]);
      return rowCount > 0;
    }
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/repositories/itemsRepository.js
git commit -m "feat: add items repository for PostgreSQL"
```

---

## Task 4: Idempotency store (TDD)

**Files:**
- Create: `server/src/services/idempotencyStore.js`
- Test: `server/test/idempotencyStore.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/idempotencyStore.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdempotencyStore } from '../src/services/idempotencyStore.js';

test('returns undefined for an unseen operationId', () => {
  const store = createIdempotencyStore();
  assert.equal(store.get('op-1'), undefined);
});

test('returns the stored result for a repeated operationId', () => {
  const store = createIdempotencyStore();
  store.set('op-1', { id: 'item-1', name: 'Milk' });
  assert.deepEqual(store.get('op-1'), { id: 'item-1', name: 'Milk' });
});

test('expires entries after the TTL', (t) => {
  let now = 1000;
  const store = createIdempotencyStore({ ttlMs: 100, clock: () => now });
  store.set('op-1', { id: 'item-1' });
  now += 150;
  assert.equal(store.get('op-1'), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test test/idempotencyStore.test.js`
Expected: FAIL — `Cannot find module '../src/services/idempotencyStore.js'`

- [ ] **Step 3: Write the implementation**

Create `server/src/services/idempotencyStore.js`:

```js
export function createIdempotencyStore({ ttlMs = 5 * 60 * 1000, clock = Date.now } = {}) {
  const entries = new Map(); // operationId -> { result, expiresAt }

  return {
    get(operationId) {
      const entry = entries.get(operationId);
      if (!entry) return undefined;
      if (clock() >= entry.expiresAt) {
        entries.delete(operationId);
        return undefined;
      }
      return entry.result;
    },
    set(operationId, result) {
      entries.set(operationId, { result, expiresAt: clock() + ttlMs });
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test test/idempotencyStore.test.js`
Expected: PASS, 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/idempotencyStore.js server/test/idempotencyStore.test.js
git commit -m "feat: add idempotency store with TTL"
```

---

## Task 5: Items service — idempotency + optimistic concurrency (TDD)

**Files:**
- Create: `server/src/services/itemsService.js`
- Test: `server/test/itemsService.test.js`

This service takes a repository and an idempotency store as dependencies (constructor injection), so it can be tested with an in-memory fake repository instead of a real database.

- [ ] **Step 1: Write the failing tests**

Create `server/test/itemsService.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createItemsService } from '../src/services/itemsService.js';
import { createIdempotencyStore } from '../src/services/idempotencyStore.js';

function fakeRepository() {
  const items = new Map();
  return {
    items,
    async insert({ id, householdId, name, qty, note, category }) {
      const item = { id, householdId, name, qty: qty || '', note: note || '', category: category || 'General Food', isChecked: false, position: items.size + 1, version: 1, updatedAt: new Date().toISOString() };
      items.set(id, item);
      return item;
    },
    async getById(id) { return items.get(id) || null; },
    async update(id, patch, expectedVersion) {
      const current = items.get(id);
      if (!current) return null;
      if (current.version !== expectedVersion) return { conflict: true, current };
      const updated = { ...current, ...patch, version: current.version + 1, updatedAt: new Date().toISOString() };
      items.set(id, updated);
      return { item: updated };
    },
    async delete(id) { return items.delete(id); }
  };
}

test('createItem twice with the same operationId only inserts once', async () => {
  const repo = fakeRepository();
  const service = createItemsService(repo, createIdempotencyStore());

  const first = await service.createItem('op-1', { id: 'item-1', householdId: 'h1', name: 'Milk' });
  const second = await service.createItem('op-1', { id: 'item-1', householdId: 'h1', name: 'Milk' });

  assert.deepEqual(first, second);
  assert.equal(repo.items.size, 1);
});

test('updateItem rejects a stale version with the current item', async () => {
  const repo = fakeRepository();
  const service = createItemsService(repo, createIdempotencyStore());

  const created = await service.createItem('op-1', { id: 'item-1', householdId: 'h1', name: 'Milk' });
  await service.updateItem('op-2', 'item-1', { isChecked: true }, created.version); // version now 2

  const result = await service.updateItem('op-3', 'item-1', { isChecked: false }, created.version); // stale: still 1
  assert.equal(result.conflict, true);
  assert.equal(result.current.version, 2);
  assert.equal(result.current.isChecked, true);
});

test('updateItem twice with the same operationId only applies once', async () => {
  const repo = fakeRepository();
  const service = createItemsService(repo, createIdempotencyStore());

  const created = await service.createItem('op-1', { id: 'item-1', householdId: 'h1', name: 'Milk' });
  const first = await service.updateItem('op-2', 'item-1', { isChecked: true }, created.version);
  const second = await service.updateItem('op-2', 'item-1', { isChecked: true }, created.version);

  assert.deepEqual(first, second);
  assert.equal(repo.items.get('item-1').version, 2); // only incremented once
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && node --test test/itemsService.test.js`
Expected: FAIL — `Cannot find module '../src/services/itemsService.js'`

- [ ] **Step 3: Write the implementation**

Create `server/src/services/itemsService.js`:

```js
export function createItemsService(repository, idempotencyStore) {
  return {
    async createItem(operationId, { id, householdId, name, qty, note, category }) {
      const cached = idempotencyStore.get(operationId);
      if (cached) return cached;

      const item = await repository.insert({ id, householdId, name, qty, note, category });
      const result = { item };
      idempotencyStore.set(operationId, result);
      return result;
    },

    async updateItem(operationId, id, patch, expectedVersion) {
      const cached = idempotencyStore.get(operationId);
      if (cached) return cached;

      const result = await repository.update(id, patch, expectedVersion);
      if (!result) return null;
      idempotencyStore.set(operationId, result);
      return result;
    },

    async deleteItem(operationId, id) {
      const cached = idempotencyStore.get(operationId);
      if (cached) return cached;

      const deleted = await repository.delete(id);
      const result = { deleted };
      idempotencyStore.set(operationId, result);
      return result;
    },

    async listItems(householdId, sort) {
      return repository.list ? repository.list(householdId, sort) : [];
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && node --test test/itemsService.test.js`
Expected: PASS, 3 tests passing. (Note: `createItem` test compares `first`/`second` which are now `{ item }` objects — both calls return the identical cached object.)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/itemsService.js server/test/itemsService.test.js
git commit -m "feat: add items service with idempotency and version conflict handling"
```

---

## Task 6: Broadcaster for WebSocket fan-out (TDD)

**Files:**
- Create: `server/src/realtime/broadcaster.js`
- Test: `server/test/broadcaster.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/broadcaster.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBroadcaster } from '../src/realtime/broadcaster.js';

function fakeSocket() {
  return { readyState: 1 /* OPEN */, sent: [], send(msg) { this.sent.push(msg); } };
}

test('broadcasts a message to all sockets in the same household', () => {
  const broadcaster = createBroadcaster();
  const a = fakeSocket();
  const b = fakeSocket();
  broadcaster.subscribe('house-1', a);
  broadcaster.subscribe('house-1', b);

  broadcaster.broadcast('house-1', { type: 'item.created', item: { id: 'x' } });

  assert.equal(a.sent.length, 1);
  assert.equal(b.sent.length, 1);
  assert.deepEqual(JSON.parse(a.sent[0]), { type: 'item.created', item: { id: 'x' } });
});

test('does not send to sockets in a different household', () => {
  const broadcaster = createBroadcaster();
  const a = fakeSocket();
  broadcaster.subscribe('house-1', a);

  broadcaster.broadcast('house-2', { type: 'item.created', item: { id: 'x' } });

  assert.equal(a.sent.length, 0);
});

test('excludes a given socket from the broadcast when requested', () => {
  const broadcaster = createBroadcaster();
  const a = fakeSocket();
  const b = fakeSocket();
  broadcaster.subscribe('house-1', a);
  broadcaster.subscribe('house-1', b);

  broadcaster.broadcast('house-1', { type: 'item.created' }, { exclude: a });

  assert.equal(a.sent.length, 0);
  assert.equal(b.sent.length, 1);
});

test('stops sending to a socket after unsubscribe', () => {
  const broadcaster = createBroadcaster();
  const a = fakeSocket();
  broadcaster.subscribe('house-1', a);
  broadcaster.unsubscribe('house-1', a);

  broadcaster.broadcast('house-1', { type: 'item.created' });

  assert.equal(a.sent.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test test/broadcaster.test.js`
Expected: FAIL — `Cannot find module '../src/realtime/broadcaster.js'`

- [ ] **Step 3: Write the implementation**

Create `server/src/realtime/broadcaster.js`:

```js
const OPEN = 1;

export function createBroadcaster() {
  const householdSockets = new Map(); // householdId -> Set<socket>

  return {
    subscribe(householdId, socket) {
      if (!householdSockets.has(householdId)) householdSockets.set(householdId, new Set());
      householdSockets.get(householdId).add(socket);
    },
    unsubscribe(householdId, socket) {
      householdSockets.get(householdId)?.delete(socket);
    },
    broadcast(householdId, message, { exclude } = {}) {
      const sockets = householdSockets.get(householdId);
      if (!sockets) return;
      const payload = JSON.stringify(message);
      for (const socket of sockets) {
        if (socket === exclude) continue;
        if (socket.readyState !== OPEN) continue;
        socket.send(payload);
      }
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test test/broadcaster.test.js`
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/realtime/broadcaster.js server/test/broadcaster.test.js
git commit -m "feat: add WebSocket broadcaster for household fan-out"
```

---

## Task 7: Items routes wired to service + broadcaster

**Files:**
- Create: `server/src/routes/itemsRoutes.js`

- [ ] **Step 1: Write the routes module**

Create `server/src/routes/itemsRoutes.js`:

```js
import express from 'express';

// Single-household mode today: every request is attached to the one
// seeded household. When real accounts are added, this becomes
// req.householdId derived from the authenticated session instead.
export function createItemsRouter({ itemsService, broadcaster, defaultHouseholdId }) {
  const router = express.Router();

  router.get('/api/lists/:listId/items', async (req, res) => {
    const sort = (req.query.sort || '').toString();
    const items = await itemsService.listItems(defaultHouseholdId, sort);
    res.json(items);
  });

  router.post('/api/items', async (req, res) => {
    const { id, name, qty, note, category, operationId } = req.body || {};
    if (!id || !name || !operationId) {
      return res.status(400).json({ error: 'id, name and operationId are required' });
    }
    const result = await itemsService.createItem(operationId, {
      id, householdId: defaultHouseholdId, name, qty, note, category
    });
    broadcaster.broadcast(defaultHouseholdId, { type: 'item.created', item: result.item });
    res.json(result.item);
  });

  router.patch('/api/items/:id', async (req, res) => {
    const { id } = req.params;
    const { operationId, version, ...patch } = req.body || {};
    if (!operationId || typeof version !== 'number') {
      return res.status(400).json({ error: 'operationId and version are required' });
    }
    const result = await itemsService.updateItem(operationId, id, patch, version);
    if (!result) return res.status(404).json({ error: 'not found' });
    if (result.conflict) return res.status(409).json({ error: 'version conflict', item: result.current });
    broadcaster.broadcast(defaultHouseholdId, { type: 'item.updated', item: result.item });
    res.json(result.item);
  });

  router.delete('/api/items/:id', async (req, res) => {
    const { id } = req.params;
    const operationId = req.body?.operationId || req.query.operationId;
    if (!operationId) return res.status(400).json({ error: 'operationId is required' });
    const result = await itemsService.deleteItem(operationId, id);
    if (!result.deleted) return res.status(404).json({ error: 'not found' });
    broadcaster.broadcast(defaultHouseholdId, { type: 'item.deleted', id });
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/itemsRoutes.js
git commit -m "feat: add items routes using itemsService and broadcaster"
```

---

## Task 8: Wire it all together in the server entrypoint

**Files:**
- Modify: `server/server.js`
- Delete: `server/db.js` (replaced by `server/src/db/*` and `server/src/repositories/itemsRepository.js`)

- [ ] **Step 1: Replace `server/server.js`**

```js
import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { pool } from './src/db/pool.js';
import { migrate } from './src/db/migrate.js';
import { createItemsRepository } from './src/repositories/itemsRepository.js';
import { createIdempotencyStore } from './src/services/idempotencyStore.js';
import { createItemsService } from './src/services/itemsService.js';
import { createBroadcaster } from './src/realtime/broadcaster.js';
import { createItemsRouter } from './src/routes/itemsRoutes.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';

const defaultHouseholdId = await migrate();

const itemsRepository = createItemsRepository(pool);
const idempotencyStore = createIdempotencyStore();
const itemsService = createItemsService(itemsRepository, idempotencyStore);
const broadcaster = createBroadcaster();

const app = express();
app.use(morgan('dev'));
app.use(express.json());
if (NODE_ENV !== 'production' && CORS_ORIGIN) {
  app.use(cors({ origin: CORS_ORIGIN }));
}

app.get('/api/health', (_, res) => res.json({ ok: true }));
app.use(createItemsRouter({ itemsService, broadcaster, defaultHouseholdId }));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  broadcaster.subscribe(defaultHouseholdId, socket);
  socket.on('close', () => broadcaster.unsubscribe(defaultHouseholdId, socket));
});

server.listen(PORT, () => {
  console.log(`Shopping List server listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Delete the old SQLite-based `server/db.js`**

Run: `git rm server/db.js`

- [ ] **Step 3: Manual smoke test**

Run: `docker compose up -d postgres && cd server && DATABASE_URL=postgres://shoppinglist:shoppinglist@localhost:5432/shoppinglist npm start`
Then in another terminal: `curl http://localhost:3000/api/health`
Expected: `{"ok":true}` and the server log shows no errors.

- [ ] **Step 4: Commit**

```bash
git add server/server.js
git commit -m "feat: wire layered server with PostgreSQL and WebSocket broadcasting"
```

---

## Task 9: One-time SQLite → PostgreSQL data migration script

**Files:**
- Create: `server/scripts/migrateFromSqlite.js`

- [ ] **Step 1: Write the script**

Create `server/scripts/migrateFromSqlite.js`:

```js
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
```

- [ ] **Step 2: Manual verification**

Run against a copy of real data: `cd server && DATABASE_URL=postgres://shoppinglist:shoppinglist@localhost:5432/shoppinglist node scripts/migrateFromSqlite.js ./data/app.db`
Expected: prints item count and "Migration complete.", and `SELECT count(*) FROM items;` in `psql` matches the old SQLite row count.

- [ ] **Step 3: Commit**

```bash
git add server/scripts/migrateFromSqlite.js
git commit -m "feat: add one-time SQLite to PostgreSQL migration script"
```

---

## Task 10: Client — generate UUIDs and operationIds for every write

**Files:**
- Modify: `client/src/api.js`

This removes the temp-ID/remap mechanism entirely: the client always assigns the item's permanent `id` itself (online or offline), so there is nothing to remap during replay.

- [ ] **Step 1: Replace `client/src/api.js`**

```js
// client/src/api.js
import {
  cacheReplaceAllItems,
  cacheUpsertItem,
  cacheDeleteItem,
  cacheGetAllItems,
  cacheGetItem
} from './db.js';

const API_BASE = ''; // same origin
const QUEUE_KEY = 'sl.queue.v1';

function newId() { return crypto.randomUUID(); }
function newOperationId() { return crypto.randomUUID(); }

// ------------- queue (localStorage) -------------
function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
  catch { return []; }
}
function saveQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
function enqueue(op) {
  const q = loadQueue();
  q.push({ ...op, enqueuedAt: Date.now() });
  saveQueue(q);
}
export function getQueueLength() {
  return loadQueue().length;
}

// ------------- HTTP helper -------------
async function http(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    const err = new Error('version conflict');
    err.conflict = true;
    err.current = data.item;
    throw err;
  }
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ------------- Public API -------------

export async function getItems(listId = 'default', sort = 'category') {
  const params = new URLSearchParams({ sort });
  try {
    const data = await http('GET', `/api/lists/${encodeURIComponent(listId)}/items?${params}`);
    await cacheReplaceAllItems(data);
    return data;
  } catch {
    return cacheGetAllItems();
  }
}

export async function addItem(item) {
  const id = newId();
  const operationId = newOperationId();
  const body = { id, operationId, name: item.name, qty: item.qty, note: item.note, category: item.category };
  const optimistic = {
    id,
    name: item.name.trim(),
    qty: item.qty || '',
    note: item.note || '',
    category: item.category || 'General Food',
    isChecked: false,
    position: 999999,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  try {
    const created = await http('POST', '/api/items', body);
    await cacheUpsertItem(created);
    return created;
  } catch {
    enqueue({ type: 'POST', path: '/api/items', body });
    await cacheUpsertItem(optimistic);
    return optimistic;
  }
}

export async function updateItem(id, patch) {
  const operationId = newOperationId();
  const existing = await cacheGetItem(id);
  const expectedVersion = existing?.version ?? 1;
  const body = { ...patch, operationId, version: expectedVersion };
  try {
    const updated = await http('PATCH', `/api/items/${id}`, body);
    await cacheUpsertItem(updated);
    return updated;
  } catch (err) {
    if (err.conflict) {
      // Server has a newer version; trust it and surface it to the caller.
      await cacheUpsertItem(err.current);
      return err.current;
    }
    const optimistic = { ...(existing || { id }), ...patch, id, updatedAt: new Date().toISOString() };
    enqueue({ type: 'PATCH', path: `/api/items/${id}`, body });
    await cacheUpsertItem(optimistic);
    return optimistic;
  }
}

export async function deleteItem(id) {
  const operationId = newOperationId();
  try {
    await http('DELETE', `/api/items/${id}`, { operationId });
  } catch {
    enqueue({ type: 'DELETE', path: `/api/items/${id}`, body: { operationId } });
  }
  await cacheDeleteItem(id);
  return true;
}

let isReplaying = false;
export async function replayQueue() {
  if (isReplaying) return getQueueLength();
  isReplaying = true;
  try {
    const q = loadQueue();
    if (!q.length) return 0;

    const next = [];
    for (const job of q) {
      try {
        if (job.type === 'POST') {
          const created = await http('POST', job.path, job.body);
          await cacheUpsertItem(created);
        } else if (job.type === 'PATCH') {
          const updated = await http('PATCH', job.path, job.body);
          await cacheUpsertItem(updated);
        } else if (job.type === 'DELETE') {
          await http('DELETE', job.path, job.body);
        }
      } catch (err) {
        if (err.conflict) {
          // Operation is resolved (server told us the current state); don't requeue.
          await cacheUpsertItem(err.current);
          continue;
        }
        next.push(job);
      }
    }

    saveQueue(next);
    return next.length;
  } finally {
    isReplaying = false;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/api.js
git commit -m "feat: client generates permanent UUIDs and idempotency keys for every write"
```

---

## Task 11: Client — WebSocket connection for live updates

**Files:**
- Create: `client/src/ws.js`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Write the WebSocket client wrapper**

Create `client/src/ws.js`:

```js
// client/src/ws.js
export function connectLiveUpdates(onMessage) {
  let socket = null;
  let reconnectTimer = null;

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
    socket.addEventListener('message', (event) => {
      try { onMessage(JSON.parse(event.data)); } catch { /* ignore malformed message */ }
    });
    socket.addEventListener('close', () => {
      reconnectTimer = setTimeout(connect, 2000);
    });
  }

  connect();

  return function disconnect() {
    clearTimeout(reconnectTimer);
    socket?.close();
  };
}
```

- [ ] **Step 2: Wire it into `App.jsx`**

In `client/src/App.jsx`, add the import near the top:

```js
import { connectLiveUpdates } from './ws.js';
```

Add a new effect (alongside the existing online/offline effect, after it) that applies incoming broadcasts to local state:

```js
  // live updates from other clients via WebSocket
  useEffect(() => {
    const disconnect = connectLiveUpdates((msg) => {
      if (msg.type === 'item.created' || msg.type === 'item.updated') {
        setItems((prev) => {
          const idx = prev.findIndex((i) => i.id === msg.item.id);
          if (idx === -1) return [...prev, msg.item];
          const next = prev.slice();
          next[idx] = msg.item;
          return next;
        });
      } else if (msg.type === 'item.deleted') {
        setItems((prev) => prev.filter((i) => i.id !== msg.id));
      }
    });
    return disconnect;
  }, []);
```

- [ ] **Step 3: Manual verification**

Run: `docker compose up -d postgres`, start the server, run `npm run dev` in `client/`. Open the app in two browser tabs. Add an item in tab A.
Expected: the item appears in tab B within ~1 second, without reloading tab B.

- [ ] **Step 4: Commit**

```bash
git add client/src/ws.js client/src/App.jsx
git commit -m "feat: live-update other clients via WebSocket broadcasts"
```

---

## Task 12: Client — reconnect sequencing (replay, then reconcile, then resume live updates)

**Files:**
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Update the `online` handler to reconcile after replay**

In `client/src/App.jsx`, the existing `goOnline` function already calls `replayQueue()` then conditionally `refresh()`. Change it to always reconcile with one fetch after a successful (queue-empty) replay, which is already the case — confirm the existing logic at lines 75-92 reads:

```js
    async function goOnline() {
      try {
        const remaining = await replayQueue(); // flush queued writes
        if (remaining === 0) {
          await refresh();                     // reconcile: one fetch to catch anything missed
          setStatus('Online (Synchronized)');
          setStatusColor('#2e7d32');
        } else {
          setStatus('Online (Sync Pending)');
          setStatusColor('#ef6c00');
        }
        setTimeout(() => setStatus(''), 3000);
      } catch {
        setStatus('Online (Sync Pending)');
        setStatusColor('#ef6c00');
        setTimeout(() => setStatus(''), 4000);
      }
    }
```

No code change needed here — this already implements "replay, then reconcile." The WebSocket connection from Task 11 is independent and keeps reconnecting on its own 2-second timer, so by the time `goOnline` finishes, live updates are already flowing. Confirm this by reading the file; if it differs, restore it to the block above.

- [ ] **Step 2: Manual verification**

Disconnect network (devtools offline mode), add two items, reconnect.
Expected: status badge goes Offline Mode → Online (Synchronized), both items appear without duplication, and a second browser tab shows them appear live.

- [ ] **Step 3: Commit (only if Step 1 required an actual change)**

```bash
git add client/src/App.jsx
git commit -m "fix: confirm reconcile-after-replay sequencing on reconnect"
```

---

## Task 13: Update README and Dockerfile references

**Files:**
- Modify: `README.md`
- Modify: `Dockerfile`
- Modify: `server/README.md`

- [ ] **Step 1: Check the Dockerfile for `DB_PATH`/SQLite references**

Run: `grep -n "DB_PATH\|sqlite\|app.db" Dockerfile server/README.md README.md`

- [ ] **Step 2: Remove any `DB_PATH` environment defaults or SQLite volume mounts found, replacing them with a note that `DATABASE_URL` must point at PostgreSQL.** Edit each matched line in place based on what the grep in Step 1 returns — there are no SQLite-specific build steps expected in the `Dockerfile` itself (it only copies `server/` and runs `npm start`), so this is primarily a `README.md`/`server/README.md` documentation update: replace any "set `DB_PATH`" instructions with "set `DATABASE_URL` to a PostgreSQL connection string" and mention `docker compose up` brings up both the app and the database.

- [ ] **Step 3: Commit**

```bash
git add README.md Dockerfile server/README.md
git commit -m "docs: update setup instructions for PostgreSQL and DATABASE_URL"
```

---

## Task 14: Full end-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Fresh start**

Run: `docker compose down -v && docker compose up -d --build`
Expected: both `shoppinglist` and `postgres` containers report healthy/running; `docker compose logs shoppinglist` shows "Shopping List server listening on http://localhost:3000" with no errors.

- [ ] **Step 2: Idempotent create — send the same POST twice**

```bash
ID=$(node -e "console.log(crypto.randomUUID())")
OP=$(node -e "console.log(crypto.randomUUID())")
curl -s -X POST http://localhost:3000/api/items -H 'Content-Type: application/json' \
  -d "{\"id\":\"$ID\",\"operationId\":\"$OP\",\"name\":\"Milk\",\"category\":\"Cold Things\"}"
curl -s -X POST http://localhost:3000/api/items -H 'Content-Type: application/json' \
  -d "{\"id\":\"$ID\",\"operationId\":\"$OP\",\"name\":\"Milk\",\"category\":\"Cold Things\"}"
curl -s "http://localhost:3000/api/lists/default/items" | grep -c "$ID"
```
Expected: both POSTs return the same item, and the final count of `$ID` occurrences is exactly 1 (no duplicate).

- [ ] **Step 3: Version conflict**

Update the item once via the UI (or curl with `version: 1`), then retry a PATCH with the stale `version: 1`.
Expected: the stale PATCH returns HTTP 409 with the current item, not a silently lost edit.

- [ ] **Step 4: Live updates across two tabs**

Open the app in two browser tabs, add/check/delete items in one.
Expected: changes appear in the other tab within ~1 second with no manual refresh.

- [ ] **Step 5: Offline round-trip**

In one tab, go offline (devtools), add 2 items and check 1 existing item, then go back online.
Expected: status badge shows Offline Mode → Online (Synchronized), no duplicate items, and the changes appear live in a second tab.

- [ ] **Step 6: Run the full automated test suite**

Run: `cd server && node --test`
Expected: all tests (idempotency store, items service, broadcaster) pass.

---

## Self-Review Notes

- **Spec coverage:** architecture (Task 8), data model (Task 2), idempotency + version conflicts (Tasks 4-5, 10), real-time broadcast (Tasks 6, 11-12), migration (Task 9), deployment (Task 1), testing (Tasks 4-6, 14) — all spec sections have a corresponding task.
- **Type consistency:** `operationId`, `version`, and `householdId`/`household_id` naming is consistent across repository (snake_case DB columns, camelCase JS), service, routes, and client.
- **No placeholders:** every code step above is complete, runnable code — none require further "fill in" work.
