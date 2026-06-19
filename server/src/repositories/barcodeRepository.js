export function createBarcodeRepository(pool) {
  return {
    async getByBarcode(householdId, barcode) {
      const { rows } = await pool.query(
        'SELECT name, category, note FROM barcode_products WHERE household_id = $1 AND barcode = $2',
        [householdId, barcode]
      );
      return rows[0] || null;
    },

    async upsert(householdId, barcode, name, category, note) {
      await pool.query(
        `INSERT INTO barcode_products (household_id, barcode, name, category, note, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (household_id, barcode)
         DO UPDATE SET name = $3, category = $4, note = $5, updated_at = now()`,
        [householdId, barcode, name, category || null, note || null]
      );
    }
  };
}
