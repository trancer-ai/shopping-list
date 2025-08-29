# 🛒 Shopping List App

A simple, fast, **offline-capable** shopping list web app with category sorting, PWA support, and optional multi-device sync via a Node.js + SQLite backend.

---

## ✨ Features

- **Add, update, delete** shopping list items
- **Category tags** (F&V, Meat, Deli, Bakery, etc.) with colour coding
- Sort by **Category**, **Alphabetical**, **Most Recent**, or **Manual** order
- **Offline mode** (PWA + local IndexedDB cache)
- Robust sync with queued POST/PATCH/DELETE and safe replay
- Manual sync button with status indicators (e.g., Sync Pending)
- Undo last change (best-effort, local history)
- Backend API with SQLite database
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
├─ server/                 # Backend (Express + better-sqlite3)
│  ├─ data/                # SQLite DB storage (ignored by Git)
│  ├─ server.js            # API routes & startup
│  ├─ db.js                # Database schema & helpers
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

## 🐳 Run with Docker
```bash
docker-compose up --build
```
The app will be available at http://localhost:5173

---

## 🔄 Offline & Sync

- Queueing: When offline, write operations (add/update/delete) are queued locally and applied to the IndexedDB cache for instant UI feedback.
- Patch merge offline: Offline updates merge patches into the cached item so untouched fields are preserved (prevents accidental data loss).
- Replay on reconnect: On network recovery, the app replays the queue to the server.
  - Temporary IDs from offline adds are remapped to real IDs to avoid duplicates.
  - Deletions and updates target the remapped IDs where applicable.
- Refresh policy: The list refreshes automatically only when the queue is fully flushed to prevent items from “disappearing/reappearing” during sync.
- Status & manual sync: The UI shows sync status (e.g., Online (Synchronized) or Sync Pending) and includes a Sync button to trigger replay.
- Diagnostics: `getQueueLength()` is available in the client API for surfacing sync state in the UI if desired.

These changes improve reliability when switching between online/offline and ensure edits are preserved without creating duplicate items.

---

## 🌐 Deployment
You can deploy the combined frontend + backend using:
- Docker
- Any Node.js hosting provider
- GitHub Actions (see `.github/workflows/`)

---

## 📜 License
MIT License.
