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
