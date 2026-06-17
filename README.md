# 🛒 Shopping List App

A simple, fast, **offline-capable** shopping list web app with category sorting, PWA support, and optional multi-device sync via a Node.js + PostgreSQL backend.

---

## ✨ Features

- **Add, update, delete** shopping list items
- **Category tags** (F&V, Meat, Deli, Bakery, etc.) with colour coding
- Sort by **Category**, **Alphabetical**, **Most Recent**, or **Manual** order
- **Offline mode** (PWA + local IndexedDB cache)
- Robust sync with queued POST/PATCH/DELETE and safe replay
- Manual sync button with status indicators (e.g., Sync Pending)
- Undo last change (best-effort, local history)
- Backend API with PostgreSQL database
- Docker & Docker Compose support
- Ready for GitHub Actions CI/CD with GHCR image publishing

---

## 📂 Repository Structure

```
shopping-list/
├─ client/                 # Frontend (Vite + React)
│  ├─ public/              # Service worker, manifest, PWA icons
│  ├─ src/                 # React components, styles, API & IndexedDB logic
│  ├─ package.json
│  └─ vite.config.js
│
├─ server/                 # Backend (Express + PostgreSQL)
│  ├─ src/
│  │  ├─ db/               # Schema, connection pool, migration runner
│  │  ├─ repositories/     # Data access (SQL lives here only)
│  │  ├─ services/         # Business logic: idempotency, version conflicts
│  │  ├─ realtime/         # WebSocket broadcaster
│  │  └─ routes/           # Express routes
│  ├─ scripts/             # One-time scripts (e.g. SQLite → Postgres migration)
│  ├─ server.js            # Entrypoint: wires everything together
│  ├─ package.json
│  └─ .env.example
│
├─ docker-compose.yml      # Multi-container stack (frontend + backend)
├─ Dockerfile              # Build container for deployment
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
The app will be available at http://localhost:5173. This brings up both the frontend and the PostgreSQL database — no separate database setup needed.

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

## 🌐 Deployment
You can deploy the combined frontend + backend using:
- Docker
- Any Node.js hosting provider
- GitHub Actions (see `.github/workflows/`)

---

## 📜 License
MIT License.
