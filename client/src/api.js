import {
  cacheGetAllItems,
  cacheReplaceAllItems,
  cacheUpsertItem,
  cacheDeleteItem,
  queueAdd,
  queueGetAll,
  queueClear
} from './db';

function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

export async function replayQueue() {
  const ops = await queueGetAll();
  if (!ops.length || !isOnline()) return;

  for (const op of ops) {
    try {
      if (op.type === 'add') {
        const res = await fetch('/api/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op.payload)
        });
        if (!res.ok) throw new Error();
        const saved = await res.json();
        await cacheUpsertItem(saved);
      } else if (op.type === 'patch') {
        const res = await fetch(`/api/items/${op.payload.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op.payload.changes)
        });
        if (!res.ok) throw new Error();
        const saved = await res.json();
        await cacheUpsertItem(saved);
      } else if (op.type === 'delete') {
        const res = await fetch(`/api/items/${op.payload.id}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) throw new Error();
        await cacheDeleteItem(op.payload.id);
      }
    } catch {
      return; // stop replay if still offline or any error
    }
  }
  await queueClear();
}

export async function getItems(listId = 'default') {
  try {
    const res = await fetch(`/api/lists/${encodeURIComponent(listId)}/items`, { cache: 'no-store' });
    if (!res.ok) throw new Error();
    const items = await res.json();
    await cacheReplaceAllItems(items);
    return items;
  } catch {
    return cacheGetAllItems();
  }
}

export async function addItem({ name, qty = '', note = '', listId = 'default' }) {
  const payload = { name, qty, note, listId };

  if (isOnline()) {
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error();
      const saved = await res.json();
      await cacheUpsertItem(saved);
      return saved;
    } catch {}
  }

  const temp = {
    id: `tmp_${Date.now()}`,
    name, qty, note, listId,
    isChecked: false,
    position: 0,
    updatedAt: new Date().toISOString()
  };
  await cacheUpsertItem(temp);
  await queueAdd({ type: 'add', payload });
  return temp;
}

export async function updateItem(id, changes) {
  if (isOnline()) {
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes)
      });
      if (!res.ok) throw new Error();
      const saved = await res.json();
      await cacheUpsertItem(saved);
      return saved;
    } catch {}
  }
  await cacheUpsertItem({ id, ...changes, updatedAt: new Date().toISOString() });
  await queueAdd({ type: 'patch', payload: { id, changes } });
}

export async function deleteItem(id) {
  if (isOnline()) {
    try {
      const res = await fetch(`/api/items/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error();
      await cacheDeleteItem(id);
      return;
    } catch {}
  }
  await cacheDeleteItem(id);
  await queueAdd({ type: 'delete', payload: { id } });
}