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
function pruneQueueForId(id) {
  const q = loadQueue();
  const next = q.filter(job => {
    if (job.tempId === id) return false;
    if (typeof job.path === 'string' && job.path.endsWith(`/api/items/${id}`)) return false;
    return true;
  });
  if (next.length !== q.length) saveQueue(next);
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
    await cacheReplaceAllItems(data);
    return data;
  } catch {
    return cacheGetAllItems();
  }
}

export async function addItem(item) {
  try {
    const created = await http('POST', `/api/items`, item);
    await cacheUpsertItem(created);
    return created;
  } catch {
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
  if (id < 0) pruneQueueForId(id); // remove queued ops for temp items
  return true;
}

export async function replayQueue() {
  let q = loadQueue();
  if (!q.length) return;

  const next = [];
  const idMap = {}; // tempId -> real id

  for (const job of q) {
    try {
      if (job.type === 'POST') {
        const created = await http('POST', job.path, job.body);
        if (job.tempId) {
          idMap[job.tempId] = created.id;
          await cacheDeleteItem(job.tempId);   // remove temp item to avoid duplicates
        }
        await cacheUpsertItem(created);
      } else if (job.type === 'PATCH') {
        const origId = Number(job.path.split('/').pop());
        const realId = idMap[origId] ?? origId;
        const path = realId !== origId ? `/api/items/${realId}` : job.path;
        const updated = await http('PATCH', path, job.body);
        await cacheUpsertItem(updated);
      } else if (job.type === 'DELETE') {
        const origId = Number(job.path.split('/').pop());
        const realId = idMap[origId] ?? origId;
        const path = realId !== origId ? `/api/items/${realId}` : job.path;
        await http('DELETE', path);
        await cacheDeleteItem(realId);
      }
    } catch {
      next.push(job); // keep failing jobs
    }
  }

  // If any jobs failed and referenced a temp id, rewrite them to the real id we learned above
  if (Object.keys(idMap).length) {
    for (const j of next) {
      if (!j.path) continue;
      const jid = Number(j.path.split('/').pop());
      if (idMap[jid]) {
        j.path = `/api/items/${idMap[jid]}`;
        delete j.tempId;
      }
    }
  }
  saveQueue(next);
}