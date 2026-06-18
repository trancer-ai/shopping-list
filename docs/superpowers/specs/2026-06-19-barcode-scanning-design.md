# Barcode Scanning — Design

Date: 2026-06-19
Status: Approved, not yet implemented

## 1. Goal

Let a user scan a product's barcode with their phone's camera from within the app, then add it to the shopping list after confirming/editing the details — instead of typing the name manually every time.

## 2. User flow

1. User taps a "Scan" button (alongside the existing manual add-item form).
2. A full-screen camera view opens. The browser decodes barcodes from the live camera feed.
3. The moment a barcode is recognized, the camera stops and a confirmation dialog opens — prefilled with whatever name/category could be found.
4. Lookup order for prefill:
   - This household's own scan history (instant, no network call).
   - If not found there, a public product database (Open Food Facts).
   - If neither has it, the dialog opens blank for manual entry.
5. The dialog uses the same fields as the existing manual add-item form: name, qty, category, note. The user can edit any field.
6. On confirm: the item is added (via the existing `addItem` flow), and the barcode → name/category mapping the user actually confirmed is saved to the household's shared scan history for next time.
7. On cancel: nothing is added, nothing is saved.

## 3. Components

### Client

- **`BarcodeScanner` component (new)** — opens `getUserMedia`, decodes frames continuously using `@zxing/browser` (a maintained, pure-JS barcode decoding library). Chosen over the native `BarcodeDetector` API because Safari on iOS doesn't support it, and this app needs to work on both iOS and Android.
- **Confirmation dialog (new, reuses existing form fields)** — same name/qty/category/note inputs as the existing manual add form, prefilled from the lookup result.
- **`api.js`** — gains a `lookupBarcode(barcode)` call (`GET /api/barcodes/:code`) and an extra optional `barcode` field passed through `addItem`'s existing POST body.

### Server

- **`server/src/repositories/barcodeRepository.js` (new)** — the only file with SQL for the new table. `getByBarcode(householdId, barcode)`, `upsert(householdId, barcode, name, category)`.
- **`server/src/services/barcodeService.js` (new)** — business logic for "what product is this barcode": checks the household's own table first via the repository; on a miss, calls Open Food Facts; returns `{ found, name, category, source: 'household' | 'public' | null }`. Performs no writes — caching happens only on confirmed item creation.
- **`server/src/integrations/openFoodFacts.js` (new)** — thin wrapper around a single `fetch` call to Open Food Facts's public product API (`https://world.openfoodfacts.org/api/v2/product/{barcode}.json`, no API key required). Isolated so it's easy to swap providers later without touching `barcodeService.js`'s logic.
- **`server/src/routes/barcodeRoutes.js` (new)** — `GET /api/barcodes/:code` → calls `barcodeService.lookup`, returns the suggestion or `{ found: false }`.
- **`server/src/routes/itemsRoutes.js` (modified)** — `POST /api/items` accepts an optional `barcode` field. After the item is successfully created, if `barcode` was provided, upserts `barcode_products` with the name/category that was actually confirmed (which may differ from the looked-up suggestion if the user edited it).

## 4. Data model

One new table, household-scoped (consistent with `items`):

```sql
barcode_products (
  household_id uuid references households(id),
  barcode text not null,
  name text not null,
  category text,
  updated_at timestamptz not null default now(),
  primary key (household_id, barcode)
)
```

Different households may label the same product differently, so this is scoped per household rather than global. `upsert` means re-confirming the same barcode with a different name simply overwrites the row.

## 5. Caching strategy: cache on confirm, not on lookup

`barcodeService.lookup` never writes to `barcode_products`. The mapping is only saved when the user actually clicks "Add" in the confirmation dialog, using whatever name/category they ended up confirming.

Rationale: this keeps the household's shared cache self-cleaning — it only ever contains barcodes a real person looked at and approved. If Open Food Facts has an incorrect, mislabeled, or oddly-formatted entry, it never gets baked into the household's permanent data; and if a user simplifies/corrects the public name in the confirm step (e.g. shortening "Heinz Baked Beans 415g Tin" to "Beans"), that's what's remembered — which is more useful than the raw public database name. The cost is that scanning the same not-yet-confirmed barcode twice in quick succession triggers two lookups instead of one; negligible at household scale.

## 6. Error handling & edge cases

- **Camera permission denied or unavailable:** show a message ("Camera access is needed to scan — you can still add items manually") and fall back to the existing manual add form. No retry loop.
- **Lookup fails or times out** (Open Food Facts unreachable, network error): treated identically to "not found" — confirmation dialog opens blank for manual entry. A flaky public API must never block adding an item.
- **Offline scanning:** barcode decoding works fully offline (camera + ZXing run client-side). The lookup call will fail offline and falls back to blank/manual entry as above. The eventual add-item call goes through the existing offline queue/replay mechanism unchanged — no special-casing needed.
- **Double-scan / scanning the same barcode twice before either is confirmed:** no special handling — each triggers its own confirmation dialog and, if both are confirmed, two items are added (equivalent to a user typing the same name twice manually).
- **Garbage/unrecognized barcode:** Open Food Facts returns not-found; same blank-dialog fallback. No extra client-side validation needed.

## 7. Testing

Following the existing pattern in `server/test/` (Node's built-in `node:test`, no new framework):

- **`barcodeService.test.js` (new)** — using a fake in-memory repository and a stubbed fetch function:
  - household-hit returns immediately without calling fetch.
  - household-miss + public-hit returns the public result tagged `source: 'public'`.
  - both-miss returns `{ found: false }`.
  - a rejected/throwing fetch is treated as not-found, not surfaced as an error.
- **No repository-layer tests** — consistent with `itemsRepository` today (would require a real Postgres instance; covered by manual verification instead).
- **No client-side automated tests** — consistent with the rest of the client (no test framework set up); camera/decoding behavior is best verified manually on a real phone.
- **Manual end-to-end verification** (to be detailed in the implementation plan):
  1. Scan a real product barcode → confirm dialog shows a public-database suggestion.
  2. Confirm add → item appears in the list.
  3. Re-scan the same barcode → confirm dialog now prefills instantly from household history (verify no Open Food Facts network call happens, e.g. via browser dev tools).
  4. Edit the name in the confirm step before adding → re-scan again → verify the household table reflects the edited name, not the original public suggestion.
  5. Deny camera permission → verify graceful fallback message and manual entry still works.
  6. Test on both an iOS and an Android phone, both over the production HTTPS URL (camera access requires a secure context).

## 8. Out of scope

- No barcode generation/printing.
- No bulk/multi-barcode scanning in one session (one scan → one confirmation → one item, repeat).
- No attempt to auto-map Open Food Facts categories onto this app's fixed 9 categories — category always defaults to "General Food" (or blank, matching today's manual-add default) and the user picks if they want something else. Auto-mapping public category tags reliably onto a small fixed set is brittle and not worth the complexity for this feature.
- No editing/deleting of saved barcode mappings via a dedicated UI — if a household wants to fix a previously-confirmed mapping, re-scanning and confirming a corrected name overwrites it (per the `upsert` behavior in Section 4).
