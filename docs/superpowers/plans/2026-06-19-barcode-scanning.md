# Barcode Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user scan a product barcode with their phone's camera, see a confirmation dialog prefilled from household history or a public product database, and add the confirmed item to the shopping list.

**Architecture:** Client decodes barcodes locally via `@zxing/browser` (works in both iOS Safari and Android Chrome, unlike the native `BarcodeDetector` API). A new server-side `barcodeService` checks a household-scoped `barcode_products` table first, then falls back to the free Open Food Facts public API. The household table is only updated when the user actually confirms adding the item — never on a raw lookup — so the shared cache stays self-cleaning.

**Tech Stack:** React/Vite client, Express/PostgreSQL server (existing routes → services → repository layering), `@zxing/browser` for camera decoding, Open Food Facts public API (no key required), Node 20's built-in global `fetch`, `node:test` for backend unit tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-19-barcode-scanning-design.md` — every task below implements a section of this spec; do not deviate without updating the spec first.
- No new backend HTTP test framework — backend routes (`itemsRoutes.js`, `barcodeRoutes.js`) and `server.js` have no automated tests in this codebase today; verify them manually (curl / browser), per existing precedent.
- No new client test framework — client code (`api.js`, React components) has no automated tests in this codebase today; verify manually on a real phone, per existing precedent.
- Repository-layer code (`barcodeRepository.js`) is not unit tested directly (requires a real Postgres), consistent with `itemsRepository.js` today — verified through manual end-to-end testing (Task 8).
- Cache-on-confirm, not cache-on-lookup: `barcodeService.lookup` must never write to `barcode_products`. Only the item-creation flow writes to it, and only after a successful create.
- Category auto-mapping from the public database is out of scope — confirmed items always default to `'General Food'` unless the household's own history has a category for that barcode.
- All new SQL must go through a repository file — no inline SQL in services or routes.
- Money quote: camera access requires HTTPS (already true in production per prior confirmation) — note this in manual verification but no code changes are needed for it.

---

### Task 1: `barcode_products` table and `barcodeRepository`

**Files:**
- Modify: `server/src/db/schema.sql`
- Create: `server/src/repositories/barcodeRepository.js`

**Interfaces:**
- Produces: `createBarcodeRepository(pool)` returning `{ getByBarcode(householdId, barcode), upsert(householdId, barcode, name, category) }`.
  - `getByBarcode` returns `{ name, category }` or `null`.
  - `upsert` returns `undefined` (fire-and-forget from the caller's perspective; it's an `INSERT ... ON CONFLICT DO UPDATE`, no return value needed by callers in this plan).

- [ ] **Step 1: Add the table to the schema**

Append to the end of `server/src/db/schema.sql`:

```sql

-- Household-scoped: different households may label the same product
-- differently. Only ever written when a user confirms adding a scanned
-- item (see itemsRoutes.js), never on a raw lookup.
CREATE TABLE IF NOT EXISTS barcode_products (
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, barcode)
);
```

- [ ] **Step 2: Write the repository**

Create `server/src/repositories/barcodeRepository.js`:

```js
export function createBarcodeRepository(pool) {
  return {
    async getByBarcode(householdId, barcode) {
      const { rows } = await pool.query(
        'SELECT name, category FROM barcode_products WHERE household_id = $1 AND barcode = $2',
        [householdId, barcode]
      );
      return rows[0] || null;
    },

    async upsert(householdId, barcode, name, category) {
      await pool.query(
        `INSERT INTO barcode_products (household_id, barcode, name, category, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (household_id, barcode)
         DO UPDATE SET name = $3, category = $4, updated_at = now()`,
        [householdId, barcode, name, category || null]
      );
    }
  };
}
```

- [ ] **Step 3: No automated test for this file**

Consistent with `itemsRepository.js` (no test file exists for it either, since it requires a real Postgres connection). This file's behavior is verified manually in Task 8.

- [ ] **Step 4: Commit**

```bash
git add server/src/db/schema.sql server/src/repositories/barcodeRepository.js
git commit -m "feat: add barcode_products table and barcodeRepository"
```

---

### Task 2: `openFoodFacts` integration wrapper

**Files:**
- Create: `server/src/integrations/openFoodFacts.js`

**Interfaces:**
- Produces: `async lookupProduct(barcode)` returning `{ name, category: null }` or `null`. Never throws — all errors (network failure, non-200 response, malformed JSON, product not found) resolve to `null`.

- [ ] **Step 1: Write the wrapper**

Create `server/src/integrations/openFoodFacts.js`:

```js
// Thin wrapper around Open Food Facts's public product API (no API key
// required). Isolated here so the provider can be swapped later without
// touching barcodeService.js's lookup logic.
const BASE_URL = 'https://world.openfoodfacts.org/api/v2/product';

export async function lookupProduct(barcode) {
  try {
    const res = await fetch(`${BASE_URL}/${encodeURIComponent(barcode)}.json`);
    if (!res.ok) return null;

    const data = await res.json();
    const name = data?.product?.product_name;
    if (data?.status !== 1 || !name) return null;

    return { name, category: null };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: No automated test for this file**

This is a thin network wrapper with no business logic to unit test in isolation (mocking global `fetch` would require a new test utility this codebase doesn't have). Its error-handling contract (never throws) is exercised indirectly by `barcodeService.test.js` in Task 3, which injects a fake version of this function's signature. Manually verify this specific file works by running it against a real barcode in Task 8.

- [ ] **Step 3: Commit**

```bash
git add server/src/integrations/openFoodFacts.js
git commit -m "feat: add Open Food Facts lookup wrapper"
```

---

### Task 3: `barcodeService` with tests

**Files:**
- Create: `server/src/services/barcodeService.js`
- Test: `server/test/barcodeService.test.js`

**Interfaces:**
- Consumes: a repository shaped like Task 1's `{ getByBarcode(householdId, barcode) }` (only `getByBarcode` is used by this service — `upsert` is called separately by `itemsRoutes.js` in Task 4, not by this service), and a `lookupPublicProduct(barcode)` function shaped like Task 2's `lookupProduct`.
- Produces: `createBarcodeService(repository, lookupPublicProduct)` returning `{ lookup(householdId, barcode) }`, where `lookup` resolves to `{ found: boolean, name: string|null, category: string|null, source: 'household'|'public'|null }`.

- [ ] **Step 1: Write the failing tests**

Create `server/test/barcodeService.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBarcodeService } from '../src/services/barcodeService.js';

function fakeRepository(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async getByBarcode(householdId, barcode) {
      return store.get(barcode) || null;
    }
  };
}

test('lookup returns a household match without calling the public lookup', async () => {
  const repo = fakeRepository({ '111': { name: 'Milk', category: 'Cold Things' } });
  let publicCalls = 0;
  const lookupPublicProduct = async () => { publicCalls++; return null; };
  const service = createBarcodeService(repo, lookupPublicProduct);

  const result = await service.lookup('h1', '111');

  assert.deepEqual(result, { found: true, name: 'Milk', category: 'Cold Things', source: 'household' });
  assert.equal(publicCalls, 0);
});

test('lookup falls back to the public lookup on a household miss', async () => {
  const repo = fakeRepository();
  const lookupPublicProduct = async (barcode) => {
    assert.equal(barcode, '222');
    return { name: 'Baked Beans', category: null };
  };
  const service = createBarcodeService(repo, lookupPublicProduct);

  const result = await service.lookup('h1', '222');

  assert.deepEqual(result, { found: true, name: 'Baked Beans', category: null, source: 'public' });
});

test('lookup returns not-found when both household and public miss', async () => {
  const repo = fakeRepository();
  const lookupPublicProduct = async () => null;
  const service = createBarcodeService(repo, lookupPublicProduct);

  const result = await service.lookup('h1', '333');

  assert.deepEqual(result, { found: false, name: null, category: null, source: null });
});

test('lookup treats a rejected public lookup as not-found, not an error', async () => {
  const repo = fakeRepository();
  const lookupPublicProduct = async () => { throw new Error('network down'); };
  const service = createBarcodeService(repo, lookupPublicProduct);

  const result = await service.lookup('h1', '444');

  assert.deepEqual(result, { found: false, name: null, category: null, source: null });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && node --test test/barcodeService.test.js`
Expected: FAIL — `Cannot find module '../src/services/barcodeService.js'`

- [ ] **Step 3: Write the implementation**

Create `server/src/services/barcodeService.js`:

```js
export function createBarcodeService(repository, lookupPublicProduct) {
  return {
    async lookup(householdId, barcode) {
      const household = await repository.getByBarcode(householdId, barcode);
      if (household) {
        return { found: true, name: household.name, category: household.category, source: 'household' };
      }

      let publicResult = null;
      try {
        publicResult = await lookupPublicProduct(barcode);
      } catch {
        publicResult = null;
      }

      if (publicResult) {
        return { found: true, name: publicResult.name, category: publicResult.category, source: 'public' };
      }

      return { found: false, name: null, category: null, source: null };
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && node --test test/barcodeService.test.js`
Expected: PASS — 4 passing tests, 0 failing

- [ ] **Step 5: Commit**

```bash
git add server/src/services/barcodeService.js server/test/barcodeService.test.js
git commit -m "feat: add barcodeService with household-first, public-fallback lookup"
```

---

### Task 4: Wire barcode lookup and confirm-time caching into the server

**Files:**
- Create: `server/src/routes/barcodeRoutes.js`
- Modify: `server/src/routes/itemsRoutes.js`
- Modify: `server/server.js`

**Interfaces:**
- Consumes: `createBarcodeRepository` (Task 1), `lookupProduct` (Task 2), `createBarcodeService` (Task 3).
- Produces: `GET /api/barcodes/:code` → `{ found, name, category, source }`. `POST /api/items` now accepts an optional `barcode` field in the request body; on success, if `barcode` was provided, the confirmed item's `name`/`category` is upserted into `barcode_products`.

- [ ] **Step 1: Write `barcodeRoutes.js`**

Create `server/src/routes/barcodeRoutes.js`:

```js
import express from 'express';

export function createBarcodeRouter({ barcodeService, defaultHouseholdId }) {
  const router = express.Router();

  router.get('/api/barcodes/:code', async (req, res) => {
    const result = await barcodeService.lookup(defaultHouseholdId, req.params.code);
    res.json(result);
  });

  return router;
}
```

- [ ] **Step 2: Modify `itemsRoutes.js` to accept `barcodeRepository` and cache on confirmed create**

In `server/src/routes/itemsRoutes.js`, change the function signature on line 6:

```js
export function createItemsRouter({ itemsService, broadcaster, defaultHouseholdId, barcodeRepository }) {
```

Then replace the `POST /api/items` handler (lines 15-25) with:

```js
  router.post('/api/items', async (req, res) => {
    const { id, name, qty, note, category, operationId, barcode } = req.body || {};
    if (!id || !name || !operationId) {
      return res.status(400).json({ error: 'id, name and operationId are required' });
    }
    const result = await itemsService.createItem(operationId, {
      id, householdId: defaultHouseholdId, name, qty, note, category
    });
    if (barcode) {
      await barcodeRepository.upsert(defaultHouseholdId, barcode, result.item.name, result.item.category);
    }
    broadcaster.broadcast(defaultHouseholdId, { type: 'item.created', item: result.item });
    res.json(result.item);
  });
```

- [ ] **Step 3: No automated test for these route changes**

Consistent with `itemsRoutes.js` having no existing test file — Express routes in this codebase are verified manually (curl / browser), not via a request-mocking framework. Verified in Task 8.

- [ ] **Step 4: Wire everything into `server.js`**

In `server/server.js`, add these imports after line 14 (`import { createItemsRouter } ...`):

```js
import { createBarcodeRepository } from './src/repositories/barcodeRepository.js';
import { createBarcodeService } from './src/services/barcodeService.js';
import { createBarcodeRouter } from './src/routes/barcodeRoutes.js';
import { lookupProduct } from './src/integrations/openFoodFacts.js';
```

Then after line 30 (`const broadcaster = createBroadcaster();`), add:

```js
const barcodeRepository = createBarcodeRepository(pool);
const barcodeService = createBarcodeService(barcodeRepository, lookupProduct);
```

Then change line 40 from:

```js
app.use(createItemsRouter({ itemsService, broadcaster, defaultHouseholdId }));
```

to:

```js
app.use(createItemsRouter({ itemsService, broadcaster, defaultHouseholdId, barcodeRepository }));
app.use(createBarcodeRouter({ barcodeService, defaultHouseholdId }));
```

- [ ] **Step 5: Run the full backend test suite to make sure nothing broke**

Run: `cd server && node --test`
Expected: PASS — all existing tests (`idempotencyStore`, `itemsService`, `broadcaster`, `barcodeService`) still pass

- [ ] **Step 6: Manually verify the server still boots**

Run: `cd server && node -e "import('./server.js')"` (requires `DATABASE_URL` set to a reachable Postgres — use your local test stack from prior sessions, or skip this exact check if no local Postgres is running and rely on Task 8's full manual verification instead)
Expected: log line `Shopping List server listening on http://localhost:3000` and no thrown errors

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/barcodeRoutes.js server/src/routes/itemsRoutes.js server/server.js
git commit -m "feat: wire barcode lookup route and confirm-time caching into the server"
```

---

### Task 5: Client `api.js` — barcode lookup and pass-through

**Files:**
- Modify: `client/src/api.js`

**Interfaces:**
- Produces: `async lookupBarcode(barcode)` returning `{ found, name, category, source }` (never throws — resolves to `{ found: false, name: null, category: null, source: null }` on any network/HTTP error). `addItem(item)` now also passes through `item.barcode` to the POST body when present.

- [ ] **Step 1: Add `lookupBarcode`**

In `client/src/api.js`, add this new exported function after `getItems` (after line 64):

```js
export async function lookupBarcode(barcode) {
  try {
    return await http('GET', `/api/barcodes/${encodeURIComponent(barcode)}`);
  } catch {
    return { found: false, name: null, category: null, source: null };
  }
}
```

- [ ] **Step 2: Pass `barcode` through in `addItem`**

In `client/src/api.js`, change the `body` construction inside `addItem` (line 69) from:

```js
  const body = { id, operationId, name: item.name, qty: item.qty, note: item.note, category: item.category };
```

to:

```js
  const body = { id, operationId, name: item.name, qty: item.qty, note: item.note, category: item.category };
  if (item.barcode) body.barcode = item.barcode;
```

- [ ] **Step 3: No automated test for this file**

Consistent with the rest of the client having no test framework set up. Verified manually in Task 8 (and incidentally exercised by hand throughout Tasks 6-7 during browser testing).

- [ ] **Step 4: Commit**

```bash
git add client/src/api.js
git commit -m "feat: add lookupBarcode and barcode pass-through to addItem"
```

---

### Task 6: `BarcodeScanner` component

**Files:**
- Modify: `client/package.json`
- Create: `client/src/BarcodeScanner.jsx`

**Interfaces:**
- Produces: a default-exported React component `<BarcodeScanner onDetected={(text) => {}} onCancel={() => {}} />`. Calls `onDetected` exactly once with the decoded barcode text, then stops the camera. Calls `onCancel` when the user taps the Cancel button. If camera access fails (permission denied, no camera, etc.), shows an inline message instead of throwing.

- [ ] **Step 1: Add the dependency**

In `client/package.json`, add to `dependencies` (alphabetical order, matching the existing two entries):

```json
    "@zxing/browser": "^0.2.0",
    "idb": "^8.0.3",
```

- [ ] **Step 2: Install it**

Run: `cd client && npm install`
Expected: `package-lock.json` updates, no errors

- [ ] **Step 3: Write the component**

Create `client/src/BarcodeScanner.jsx`:

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

export default function BarcodeScanner({ onDetected, onCancel }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls = null;
    let detected = false;

    reader
      .decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current,
        (result) => {
          if (detected || !result) return;
          detected = true;
          controls?.stop();
          onDetected(result.getText());
        }
      )
      .then((c) => {
        controls = c;
        if (detected) controls.stop(); // detected before the promise resolved
      })
      .catch(() => {
        setError('Camera access is needed to scan — you can still add items manually.');
      });

    return () => {
      detected = true;
      controls?.stop();
    };
  }, [onDetected]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {error ? (
        <p style={{ color: '#fff', padding: 24, textAlign: 'center' }}>{error}</p>
      ) : (
        <video ref={videoRef} style={{ maxWidth: '100%', maxHeight: '80%' }} muted playsInline />
      )}
      <button onClick={onCancel} style={{ marginTop: 16 }}>Cancel</button>
    </div>
  );
}
```

- [ ] **Step 4: No automated test for this file**

Camera/decoding behavior cannot be meaningfully unit-tested without a real camera and a real barcode in frame; this is verified manually on an actual phone in Task 8, consistent with the spec's testing section.

- [ ] **Step 5: Commit**

```bash
git add client/package.json client/package-lock.json client/src/BarcodeScanner.jsx
git commit -m "feat: add BarcodeScanner component using @zxing/browser"
```

---

### Task 7: Wire scanning into `App.jsx`

**Files:**
- Modify: `client/src/App.jsx`

**Interfaces:**
- Consumes: `lookupBarcode` (Task 5), `addItem` (already imported, now accepts `barcode`), `BarcodeScanner` (Task 6).

- [ ] **Step 1: Import the new pieces**

In `client/src/App.jsx`, change line 2 from:

```js
import { getItems, addItem, updateItem, deleteItem, replayQueue, getQueueLength } from './api.js';
```

to:

```js
import { getItems, addItem, updateItem, deleteItem, replayQueue, getQueueLength, lookupBarcode } from './api.js';
```

And add a new import after line 3 (`import { connectLiveUpdates } from './ws.js';`):

```js
import BarcodeScanner from './BarcodeScanner.jsx';
```

- [ ] **Step 2: Add scanning state**

In `client/src/App.jsx`, after line 39 (`const [form, setForm] = useState({ name: '', qty: '', note: '', category: DEFAULT_CAT });`), add:

```js
  const [scanning, setScanning] = useState(false);
  const [scanForm, setScanForm] = useState(null); // null = no confirm dialog open
```

- [ ] **Step 3: Add the scan handlers**

In `client/src/App.jsx`, after the `onAdd` function (after line 128, right before `async function toggleChecked(item) {`), add:

```js
  async function onBarcodeDetected(code) {
    setScanning(false);
    const lookup = await lookupBarcode(code);
    const category = CATS.some(c => c.key === lookup.category) ? lookup.category : DEFAULT_CAT;
    setScanForm({ barcode: code, name: lookup.name || '', qty: '', note: '', category });
  }

  function onCancelScan() {
    setScanning(false);
  }

  async function onConfirmScan(e) {
    e.preventDefault();
    if (!scanForm.name.trim()) return;
    pushHistory();
    await addItem({ ...scanForm, listId: 'default' });
    await refresh();
    setScanForm(null);
  }

  function onCancelConfirm() {
    setScanForm(null);
  }
```

- [ ] **Step 4: Add the Scan button**

In `client/src/App.jsx`, in the actions row (lines 277-282), add a Scan button as the first button:

```jsx
          <div className="actions" style={{ marginLeft: 'auto' }}>
            <button onClick={() => setScanning(true)} aria-label="Scan barcode">📷 Scan</button>
            <button onClick={manualSync} aria-label="Sync now">⟳ Sync</button>
            <button onClick={undoLast} disabled={!history.length} aria-label="Undo last">↶ Undo</button>
            <button onClick={deleteChecked} disabled={!hasChecked} aria-label="Delete checked">🗑︎ Checked</button>
            <button onClick={deleteAll} disabled={!items.length} aria-label="Delete all">🗑︎ All</button>
          </div>
```

- [ ] **Step 5: Render the scanner and confirmation dialog**

In `client/src/App.jsx`, just before the closing `</div>` at the very end of the component (after the closing `</ul>` on line 365), add:

```jsx
      {scanning && (
        <BarcodeScanner onDetected={onBarcodeDetected} onCancel={onCancelScan} />
      )}

      {scanForm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.5)',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <form onSubmit={onConfirmScan} className="card" style={{ background: '#fff', maxWidth: 360, width: '90%' }}>
            <h2>Confirm item</h2>
            <div className="row">
              <input
                placeholder="Item name"
                value={scanForm.name}
                onChange={e => setScanForm({ ...scanForm, name: e.target.value })}
                required
              />
            </div>
            <div className="row">
              <input
                placeholder="Qty (optional)"
                value={scanForm.qty}
                onChange={e => setScanForm({ ...scanForm, qty: e.target.value })}
              />
              <input
                placeholder="Note (optional)"
                value={scanForm.note}
                onChange={e => setScanForm({ ...scanForm, note: e.target.value })}
              />
            </div>
            <div className="row">
              <select
                value={scanForm.category}
                onChange={e => setScanForm({ ...scanForm, category: e.target.value })}
                aria-label="Category"
              >
                {CATS.map(c => <option key={c.key} value={c.key}>{c.key}</option>)}
              </select>
              <button type="submit">Add</button>
              <button type="button" onClick={onCancelConfirm}>Cancel</button>
            </div>
          </form>
        </div>
      )}
```

- [ ] **Step 6: No automated test for this file**

Consistent with the rest of the client. Verified manually in Task 8.

- [ ] **Step 7: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat: wire barcode scanning into the shopping list UI"
```

---

### Task 8: Manual end-to-end verification

**Files:** none (verification only)

This task has no code changes — it confirms the whole feature works on real devices before the branch is finished. Use your established local test stack (production-like Docker build) or the live HTTPS server, since camera access requires a secure context.

- [ ] **Step 1: Scan a real product barcode**

On a phone, open the app over HTTPS, tap "📷 Scan", point the camera at a real product's barcode.
Expected: the confirmation dialog opens with a name prefilled from Open Food Facts (verify in browser dev tools / server logs that this came from the public lookup, not household history, since it's the first scan).

- [ ] **Step 2: Confirm the add**

Tap "Add" on the confirmation dialog.
Expected: the item appears in the shopping list with the confirmed name/qty/category/note.

- [ ] **Step 3: Re-scan the same barcode**

Scan the exact same product again.
Expected: the confirmation dialog prefills instantly from household history this time — verify via server logs or `psql`/dev-tools network tab that no Open Food Facts request happens on this second scan.

- [ ] **Step 4: Edit the name before confirming, then re-scan**

On a third scan of the same barcode, edit the name in the confirmation dialog (e.g. shorten it) before tapping "Add". Then scan the same barcode a fourth time.
Expected: the fourth scan's prefilled name reflects the edited name from step 4, not the original Open Food Facts name — confirms `barcode_products` was overwritten by the `upsert`, not just inserted once.

- [ ] **Step 5: Deny camera permission**

Revoke camera permission for the site (browser settings) and tap "📷 Scan" again.
Expected: the inline "Camera access is needed to scan — you can still add items manually" message appears instead of a crash; the normal manual add form still works.

- [ ] **Step 6: Cross-device check**

Repeat steps 1-2 on both an iOS and an Android phone, both over the production HTTPS URL.
Expected: scanning and decoding work on both.

- [ ] **Step 7: Confirm the full backend test suite still passes**

Run: `cd server && node --test`
Expected: PASS — all tests including `barcodeService.test.js`

This completes the feature. Proceed to `superpowers:finishing-a-development-branch` once all manual checks pass.
