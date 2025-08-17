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

let isReplaying = false;

export async function replayQueue() {
  if (isReplaying) return;        // prevent concurrent replays
  isReplaying = true;
  try {
    let q = loadQueue();
    if (!q.length) return;

    const next = [];
    const idMap = {}; // tempId -> realId

    for (const job of q) {
      if (job.type === 'POST') {
        let created;
        try {
          created = await http('POST', job.path, job.body);
        } catch {
          next.push(job); // only requeue if HTTP failed
          continue;
        }
        if (job.tempId) {
          idMap[job.tempId] = created.id;
          try { await cacheDeleteItem(job.tempId); } catch {}
        }
        try { await cacheUpsertItem(created); } catch {}
      } else if (job.type === 'PATCH') {
        const origId = Number(job.path.split('/').pop());
        const realId = idMap[origId] ?? origId;
        const path = realId !== origId ? `/api/items/${realId}` : job.path;

        let updated;
        try {
          updated = await http('PATCH', path, job.body);
        } catch {
          next.push({ ...job, path });
          continue;
        }
        try { await cacheUpsertItem(updated); } catch {}
      } else if (job.type === 'DELETE') {
        const origId = Number(job.path.split('/').pop());
        const realId = idMap[origId] ?? origId;
        const path = realId !== origId ? `/api/items/${realId}` : job.path;

        try {
          await http('DELETE', path);
        } catch {
          next.push({ ...job, path });
          continue;
        }
        try { await cacheDeleteItem(realId); } catch {}
      }
    }

    saveQueue(next);
  } finally {
    isReplaying = false;
  }
}