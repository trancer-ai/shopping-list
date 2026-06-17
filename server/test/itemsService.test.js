import test from 'node:test';
import assert from 'node:assert/strict';
import { createItemsService } from '../src/services/itemsService.js';
import { createIdempotencyStore } from '../src/services/idempotencyStore.js';

function fakeRepository() {
  const items = new Map();
  return {
    items,
    async insert({ id, householdId, name, qty, note, category }) {
      const item = { id, householdId, name, qty: qty || '', note: note || '', category: category || 'General Food', isChecked: false, position: items.size + 1, version: 1, updatedAt: new Date().toISOString() };
      items.set(id, item);
      return item;
    },
    async getById(id) { return items.get(id) || null; },
    async update(id, patch, expectedVersion) {
      const current = items.get(id);
      if (!current) return null;
      if (current.version !== expectedVersion) return { conflict: true, current };
      const updated = { ...current, ...patch, version: current.version + 1, updatedAt: new Date().toISOString() };
      items.set(id, updated);
      return { item: updated };
    },
    async delete(id) { return items.delete(id); }
  };
}

test('createItem twice with the same operationId only inserts once', async () => {
  const repo = fakeRepository();
  const service = createItemsService(repo, createIdempotencyStore());

  const first = await service.createItem('op-1', { id: 'item-1', householdId: 'h1', name: 'Milk' });
  const second = await service.createItem('op-1', { id: 'item-1', householdId: 'h1', name: 'Milk' });

  assert.deepEqual(first, second);
  assert.equal(repo.items.size, 1);
});

test('updateItem rejects a stale version with the current item', async () => {
  const repo = fakeRepository();
  const service = createItemsService(repo, createIdempotencyStore());

  const created = await service.createItem('op-1', { id: 'item-1', householdId: 'h1', name: 'Milk' });
  await service.updateItem('op-2', 'item-1', { isChecked: true }, created.item.version); // version now 2

  const result = await service.updateItem('op-3', 'item-1', { isChecked: false }, created.item.version); // stale: still 1
  assert.equal(result.conflict, true);
  assert.equal(result.current.version, 2);
  assert.equal(result.current.isChecked, true);
});

test('updateItem twice with the same operationId only applies once', async () => {
  const repo = fakeRepository();
  const service = createItemsService(repo, createIdempotencyStore());

  const created = await service.createItem('op-1', { id: 'item-1', householdId: 'h1', name: 'Milk' });
  const first = await service.updateItem('op-2', 'item-1', { isChecked: true }, created.item.version);
  const second = await service.updateItem('op-2', 'item-1', { isChecked: true }, created.item.version);

  assert.deepEqual(first, second);
  assert.equal(repo.items.get('item-1').version, 2); // only incremented once
});
