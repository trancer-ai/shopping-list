import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdempotencyStore } from '../src/services/idempotencyStore.js';

test('returns undefined for an unseen operationId', () => {
  const store = createIdempotencyStore();
  assert.equal(store.get('op-1'), undefined);
});

test('returns the stored result for a repeated operationId', () => {
  const store = createIdempotencyStore();
  store.set('op-1', { id: 'item-1', name: 'Milk' });
  assert.deepEqual(store.get('op-1'), { id: 'item-1', name: 'Milk' });
});

test('expires entries after the TTL', (t) => {
  let now = 1000;
  const store = createIdempotencyStore({ ttlMs: 100, clock: () => now });
  store.set('op-1', { id: 'item-1' });
  now += 150;
  assert.equal(store.get('op-1'), undefined);
});
