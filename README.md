# 🛒 Shopping List App

A simple, fast, **offline-capable** shopping list web app with category sorting, PWA support, and optional multi-device sync via a Node.js + SQLite backend.

---

## ✨ Features

- **Add, update, delete** shopping list items
- **Category tags** (F&V, Meat, Deli, Bakery, etc.) with colour coding
- Sort by **Category**, **Alphabetical**, **Most Recent**, or **Manual** order
- **Offline mode** (PWA + local IndexedDB cache)
- Automatic sync when reconnected (queued changes replay)
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

## 🌐 Deployment
You can deploy the combined frontend + backend using:
- Docker
- Any Node.js hosting provider
- GitHub Actions (see `.github/workflows/`)

---

## 📜 License
MIT License.
