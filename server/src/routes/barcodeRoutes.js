import express from 'express';

export function createBarcodeRouter({ barcodeService, defaultHouseholdId }) {
  const router = express.Router();

  router.get('/api/barcodes/:code', async (req, res) => {
    const result = await barcodeService.lookup(defaultHouseholdId, req.params.code);
    res.json(result);
  });

  return router;
}
