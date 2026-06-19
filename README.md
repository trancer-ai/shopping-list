# 🛒 Shopping List App

A simple, fast, **offline-capable** shopping list web app with category sorting, PWA support, household-scoped multi-device sync, and barcode scanning — backed by a Node.js + PostgreSQL backend with live WebSocket updates.

---

## ✨ Features

- **Add, update, delete** shopping list items
- **📷 Barcode scanning**: scan a product with your phone's camera to prefill name, category and pack size before adding (see [Barcode Scanning](#-barcode-scanning) below)
- **Category tags** (F&V, Meat, Deli, Bakery, etc.) with colour coding
- Sort by **Category**, **Alphabetical**, **Most Recent**, or **Manual** order
- **Offline mode** (PWA + local IndexedDB cache)
- Robust sync with queued POST/PATCH/DELETE and safe replay
- **Live updates**: other connected devices see your changes instantly over WebSocket, no refresh needed
- Manual sync button with status indicators (e.g., Sync Pending)
- Undo last change (best-effort, local history)
- Household-scoped backend (PostgreSQL) — built for multi-device/multi-person use; no login UI yet, but the data model is already user/household-aware
- Docker & Docker Compose support
- Ready for GitHub Actions CI/CD with GHCR image publishing

---

## 📂 Repository Structure

```
shopping-list/
├─ client/                 # Frontend (Vite + React)
│  ├─ public/              # Service worker, manifest, PWA icons
│  ├─ src/
│  │  ├─ App.jsx            # UI, local state, undo/history, sort, reorder
│  │  ├─ BarcodeScanner.jsx # Camera barcode decoding (@zxing/browser)
│  │  ├─ api.js             # HTTP client, offline queue, idempotency keys
│  │  ├─ ws.js               # WebSocket client for live updates
│  │  ├─ db.js               # IndexedDB cache
│  │  └─ main.jsx            # Bootstraps queue replay + SW registration
│  ├─ package.json
│  └─ vite.config.js
│
├─ server/                 # Backend (Express + PostgreSQL)
│  ├─ src/
│  │  ├─ db/               # Schema, connection pool, migration runner
│  │  ├─ repositories/     # Data access (SQL lives here only)
│  │  ├─ services/         # Business logic: idempotency, version conflicts, barcode lookup
│  │  ├─ integrations/     # External API wrappers (Open Food Facts)
│  │  ├─ realtime/         # WebSocket broadcaster
│  │  └─ routes/           # Express routes
│  ├─ scripts/             # One-time scripts (e.g. SQLite → Postgres migration)
│  ├─ server.js            # Entrypoint: wires everything together
│  ├─ package.json
│  └─ .env.example
│
├─ docker-compose.yml      # Multi-container stack (app + Postgres)
├─ Dockerfile              # Build container for deployment (client + server in one image)
├─ .github/workflows/      # Optional GitHub Actions CI/CD
├─ .gitignore
└─ README.md
```

---

## 🖥 Local Development

### Prerequisites
- [Node.js](https://nodejs.org/) v18+ (LTS recommended)
- [npm](https://www.npmjs.com/) v8+
- [Docker](https://www.docker.com/) *(optional for containerized dev)*

---

### 1. Backend (server)
```bash
cd server
cp .env.example .env   # adjust settings if needed
npm install
npm start              # starts on http://localhost:3000
```

---

### 2. Frontend (client)
Open a second terminal:
```bash
cd client
npm install
npm run dev            # starts on http://localhost:5173
```

---

## 🐳 Run with Docker Compose
```bash
docker-compose up --build
```
This builds one image (the client is built and served as static files by the Express server, on the same port) and brings up Postgres alongside it — no separate database setup needed.

By default, `docker-compose.yml` publishes **no ports** — it's meant to sit behind a reverse proxy on a shared Docker network (see `external_net` in the compose file). For local/LAN access without a proxy, uncomment the `ports: - "3000:3000"` line under the `shoppinglist` service, then the app is available at `http://localhost:3000` (or `http://<your-LAN-IP>:3000` from another device). Camera-based barcode scanning requires HTTPS (a secure context) — see [Barcode Scanning](#-barcode-scanning) below.

To fully reset the database (remove all data and volumes):
```bash
docker-compose down -v
```

---

## 🔄 Offline & Sync

- Queueing: When offline, write operations (add/update/delete) are queued locally and applied to the IndexedDB cache for instant UI feedback.
- Permanent client-generated IDs: every item gets a UUID and an idempotency key (`operationId`) at creation time, on the client. There's no temporary ID or server-side remapping — replaying a queued operation twice is safe because the server recognizes the repeated `operationId` and returns the original result instead of applying it again.
- Optimistic concurrency: updates carry the `version` the client last saw. If another client changed the item first, the server rejects the update (HTTP 409) with the current item instead of silently overwriting it.
- Replay on reconnect: On network recovery, the app replays the queue to the server, then does one reconciling fetch, then resumes listening for live updates over WebSocket.
- Live updates: connected clients receive other clients' changes over WebSocket without needing to refresh.
- Refresh policy: The list refreshes automatically only when the queue is fully flushed to prevent items from “disappearing/reappearing” during sync.
- Status & manual sync: The UI shows sync status (e.g., Online (Synchronized) or Sync Pending) and includes a Sync button to trigger replay.
- Diagnostics: `getQueueLength()` is available in the client API for surfacing sync state in the UI if desired.

These changes improve reliability for concurrent, multi-device use and ensure edits are preserved without creating duplicate items.

---

## 👥 Households & real-time updates

The backend is household-scoped: every item belongs to a household, and `users`/`household_members` tables already exist in the schema (nullable, unused today) so real accounts can be turned on later without a data migration. Today there's a single implicit household and no login UI.

Every write broadcasts over WebSocket (`/ws`, same port as the HTTP API) to other clients connected to that household, so changes from one device appear on others without a manual refresh. The client auto-reconnects on disconnect.

---

## 📷 Barcode Scanning

Tap **Scan** to open the camera, point it at a product barcode, and the app prefills a confirmation dialog (name, category, pack size, qty, note) before adding the item — letting you correct or fill in anything before it's saved.

- Decoding happens entirely in the browser (`@zxing/browser`), so it works offline; only the **lookup** of what the barcode means needs a network call.
- Lookup order: your household's own previously-confirmed scans first (instant, no network call), then [Open Food Facts](https://world.openfoodfacts.org/) (a free, open product database) as a fallback.
- **Cache-on-confirm**: a barcode → product mapping is only saved to your household's shared history when you actually confirm adding the item — never on a raw lookup. This keeps the cache self-cleaning (only ever contains products a real person reviewed and approved) and means a correction you make in the dialog (e.g. shortening a long public-database name) is what's remembered next time, not the original public name.
- Requires a secure context (HTTPS, or `localhost`) — camera access is blocked by the browser otherwise.
- If camera access is denied or fails, the app falls back to a message and the normal manual add-item form still works.

---

## 🌐 Deployment
You can deploy the combined frontend + backend using:
- Docker
- Any Node.js hosting provider
- GitHub Actions (see `.github/workflows/`)

---

## 📜 License
MIT License.
