// client/src/db.js
import { openDB } from 'idb';

// One store: items (keyed by id)
const dbPromise = openDB('shopping-list', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('items')) {
      const items = db.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('byUpdatedAt', 'updatedAt');
    }
  }
});

export async function cacheReplaceAllItems(items) {
  const db = await dbPromise;
  const tx = db.transaction('items', 'readwrite');
  await tx.store.clear();
  for (const it of items) await tx.store.put(it);
  await tx.done;
}

export async function cacheUpsertItem(item) {
  const db = await dbPromise;
  await db.put('items', item);
}

export async function cacheDeleteItem(id) {
  const db = await dbPromise;
  await db.delete('items', id);
}

export async function cacheGetAllItems() {
  const db = await dbPromise;
  // Return newest first (helps recent sort if you need it offline)
  const all = await db.getAll('items');
  return all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}