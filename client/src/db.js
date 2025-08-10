import { openDB } from 'idb';

const dbPromise = openDB('shopping-list', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('items')) {
      const items = db.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('byUpdatedAt', 'updatedAt');
    }
    if (!db.objectStoreNames.contains('queue')) {
      db.createObjectStore('queue', { keyPath: 'qid', autoIncrement: true });
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
  return db.getAll('items');
}

export async function queueAdd(op) {
  const db = await dbPromise;
  return db.add('queue', { ...op, ts: Date.now() });
}
export async function queueGetAll() {
  const db = await dbPromise;
  return db.getAll('queue');
}
export async function queueClear() {
  const db = await dbPromise;
  const tx = db.transaction('queue', 'readwrite');
  await tx.store.clear();
  await tx.done;
}