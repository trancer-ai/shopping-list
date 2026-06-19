import express from 'express';

// Single-household mode today: every request is attached to the one
// seeded household. When real accounts are added, this becomes
// req.householdId derived from the authenticated session instead.
export function createItemsRouter({ itemsService, broadcaster, defaultHouseholdId, barcodeRepository }) {
  const router = express.Router();

  router.get('/api/lists/:listId/items', async (req, res) => {
    const sort = (req.query.sort || '').toString();
    const items = await itemsService.listItems(defaultHouseholdId, sort);
    res.json(items);
  });

  router.post('/api/items', async (req, res) => {
    const { id, name, qty, note, category, operationId, barcode } = req.body || {};
    if (!id || !name || !operationId) {
      return res.status(400).json({ error: 'id, name and operationId are required' });
    }
    const result = await itemsService.createItem(operationId, {
      id, householdId: defaultHouseholdId, name, qty, note, category
    });
    if (barcode) {
      await barcodeRepository.upsert(defaultHouseholdId, barcode, result.item.name, result.item.category);
    }
    broadcaster.broadcast(defaultHouseholdId, { type: 'item.created', item: result.item });
    res.json(result.item);
  });

  router.patch('/api/items/:id', async (req, res) => {
    const { id } = req.params;
    const { operationId, version, ...patch } = req.body || {};
    if (!operationId || typeof version !== 'number') {
      return res.status(400).json({ error: 'operationId and version are required' });
    }
    const result = await itemsService.updateItem(operationId, id, patch, version);
    if (!result) return res.status(404).json({ error: 'not found' });
    if (result.conflict) return res.status(409).json({ error: 'version conflict', item: result.current });
    broadcaster.broadcast(defaultHouseholdId, { type: 'item.updated', item: result.item });
    res.json(result.item);
  });

  router.delete('/api/items/:id', async (req, res) => {
    const { id } = req.params;
    const operationId = req.body?.operationId || req.query.operationId;
    if (!operationId) return res.status(400).json({ error: 'operationId is required' });
    const result = await itemsService.deleteItem(operationId, id);
    if (!result.deleted) return res.status(404).json({ error: 'not found' });
    broadcaster.broadcast(defaultHouseholdId, { type: 'item.deleted', id });
    res.status(204).end();
  });

  return router;
}
