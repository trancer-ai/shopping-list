// client/src/api.js
import {
  cacheReplaceAllItems,
  cacheUpsertItem,
  cacheDeleteItem,
  cacheGetAllItems
} from './db.js';

const API_BASE = ''; // same origin
const QUEUE_KEY = 'sl.queue.v1';

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

// ------------- HTTP helper -------------
async function http(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
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
    // keep cache in sync for offline cold starts
    await cacheReplaceAllItems(data);
    return data;
  } catch {
    // offline (or server down): fall back to last cached list
    return cacheGetAllItems();
  }
}

export async function addItem(item) {
  try {
    const created = await http('POST', `/api/items`, item);
    await cacheUpsertItem(created);
    return created;
  } catch {
    // Offline: optimistic temp item + queue
    const tempId = -Date.now();
    const temp = {
      id: tempId,
      listId: item.listId || 'default',
      name: item.name.trim(),
      qty: item.qty || '',
      note: item.note || '',
      category: item.category || 'General Food',
      isChecked: false,
      position: 999999,
      updatedAt: new Date().toISOString(),
    };
    enqueue({ type: 'POST', path: '/api/items', body: item, tempId });
    await cacheUpsertItem(temp);
    return temp;
  }
}

export async function updateItem(id, patch) {
  try {
    const updated = await http('PATCH', `/api/items/${id}`, patch);
    await cacheUpsertItem(updated);
    return updated;
  } catch {
    // Optimistic local update
    const optimistic = { id, ...patch, updatedAt: new Date().toISOString() };
    enqueue({ type: 'PATCH', path: `/api/items/${id}`, body: patch });
    await cacheUpsertItem(optimistic);
    return optimistic;
  }
}

export async function deleteItem(id) {
  try {
    await http('DELETE', `/api/items/${id}`);
  } catch {
    enqueue({ type: 'DELETE', path: `/api/items/${id}` });
  }
  await cacheDeleteItem(id);
  return true;
}

export async function replayQueue() {
  let q = loadQueue();
  if (!q.length) return;

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
        await http('DELETE', job.path);
        const id = Number(job.path.split('/').pop());
        await cacheDeleteItem(id);
      }
      // success: drop
    } catch {
      next.push(job); // still failing, keep it
      // Optionally break here to avoid hammering
      // break;
    }
  }
  saveQueue(next);
}