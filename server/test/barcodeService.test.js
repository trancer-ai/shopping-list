import test from 'node:test';
import assert from 'node:assert/strict';
import { createBarcodeService } from '../src/services/barcodeService.js';

function fakeRepository(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async getByBarcode(householdId, barcode) {
      return store.get(barcode) || null;
    }
  };
}

test('lookup returns a household match without calling the public lookup', async () => {
  const repo = fakeRepository({ '111': { name: 'Milk', category: 'Cold Things' } });
  let publicCalls = 0;
  const lookupPublicProduct = async () => { publicCalls++; return null; };
  const service = createBarcodeService(repo, lookupPublicProduct);

  const result = await service.lookup('h1', '111');

  assert.deepEqual(result, { found: true, name: 'Milk', category: 'Cold Things', source: 'household' });
  assert.equal(publicCalls, 0);
});

test('lookup falls back to the public lookup on a household miss', async () => {
  const repo = fakeRepository();
  const lookupPublicProduct = async (barcode) => {
    assert.equal(barcode, '222');
    return { name: 'Baked Beans', category: null };
  };
  const service = createBarcodeService(repo, lookupPublicProduct);

  const result = await service.lookup('h1', '222');

  assert.deepEqual(result, { found: true, name: 'Baked Beans', category: null, source: 'public' });
});

test('lookup returns not-found when both household and public miss', async () => {
  const repo = fakeRepository();
  const lookupPublicProduct = async () => null;
  const service = createBarcodeService(repo, lookupPublicProduct);

  const result = await service.lookup('h1', '333');

  assert.deepEqual(result, { found: false, name: null, category: null, source: null });
});

test('lookup treats a rejected public lookup as not-found, not an error', async () => {
  const repo = fakeRepository();
  const lookupPublicProduct = async () => { throw new Error('network down'); };
  const service = createBarcodeService(repo, lookupPublicProduct);

  const result = await service.lookup('h1', '444');

  assert.deepEqual(result, { found: false, name: null, category: null, source: null });
});
