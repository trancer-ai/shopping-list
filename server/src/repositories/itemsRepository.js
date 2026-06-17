const CATEGORIES = [
  'F&V', 'Meat', 'Deli', 'Bakery', 'General Food', 'Personal', 'Cleaning', 'Cold Things', 'Utilities'
];
export const isValidCategory = (c) => CATEGORIES.includes(c);
export { CATEGORIES };

function normalize(r) {
  return {
    id: r.id,
    householdId: r.household_id,
    name: r.name,
    qty: r.qty ?? '',
    note: r.note ?? '',
    category: r.category ?? 'General Food',
    isChecked: r.is_checked,
    position: r.position,
    version: r.version,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at
  };
}

export function createItemsRepository(pool) {
  return {
    async list(householdId, sort) {
      let orderBy = 'position ASC, id ASC';
      if (sort === 'alpha') orderBy = 'name COLLATE "C" ASC, id ASC';
      else if (sort === 'recent') orderBy = 'updated_at DESC, id DESC';
      else if (sort === 'category') {
        // CATEGORIES is a fixed internal array (never user input), so inlining its
        // values here is safe today. If CATEGORIES ever becomes user-configurable,
        // this must be parameterized instead.
        const cases = CATEGORIES.map((c, i) => `WHEN '${c}' THEN ${i}`).join(' ');
        orderBy = `CASE category ${cases} ELSE ${CATEGORIES.length} END ASC, name COLLATE "C" ASC`;
      }
      const { rows } = await pool.query(
        `SELECT * FROM items WHERE household_id = $1 ORDER BY ${orderBy}`,
        [householdId]
      );
      return rows.map(normalize);
    },

    // Note: not scoped by household_id - intentional for now, since callers
    // (service/route layer) are expected to supply and enforce the household
    // context. A deliberate repository-layer simplicity tradeoff, not an oversight.
    async getById(id) {
      const { rows } = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
      return rows[0] ? normalize(rows[0]) : null;
    },

    async insert({ id, householdId, name, qty, note, category }) {
      const cat = isValidCategory(category) ? category : 'General Food';
      // Position is computed via a subquery inside the same INSERT statement
      // (rather than a separate SELECT MAX + INSERT) to close the TOCTOU window
      // where two concurrent inserts for the same household could read the same
      // max position before either commits.
      const { rows } = await pool.query(
        `INSERT INTO items (id, household_id, name, qty, note, category, position, is_checked, version, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6,
           (SELECT COALESCE(MAX(position), 0) + 1 FROM items WHERE household_id = $2),
           false, 1, now())
         RETURNING *`,
        [id, householdId, name.trim(), qty || '', note || '', cat]
      );
      return normalize(rows[0]);
    },

    // Returns null if the item doesn't exist, { conflict: true, current } if
    // expectedVersion doesn't match the latest row, otherwise { item: <updated row> }.
    //
    // The version check is performed atomically as part of the UPDATE's WHERE
    // clause (rather than via a separate preceding SELECT) so that a concurrent
    // write landing between "check" and "write" can't defeat optimistic concurrency.
    async update(id, patch, expectedVersion) {
      const fields = [];
      const values = [];
      let i = 1;
      if (typeof patch.name === 'string') { fields.push(`name = $${i++}`); values.push(patch.name.trim()); }
      if (typeof patch.qty === 'string') { fields.push(`qty = $${i++}`); values.push(patch.qty); }
      if (typeof patch.note === 'string') { fields.push(`note = $${i++}`); values.push(patch.note); }
      if (typeof patch.isChecked === 'boolean') { fields.push(`is_checked = $${i++}`); values.push(patch.isChecked); }
      if (typeof patch.position === 'number') { fields.push(`position = $${i++}`); values.push(patch.position); }
      if (typeof patch.category === 'string' && isValidCategory(patch.category)) {
        fields.push(`category = $${i++}`); values.push(patch.category);
      }

      if (fields.length === 0) {
        // No-op patch: still must validate version against current state, since
        // callers may call update() with no real changes just to check state.
        const { rows } = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
        if (rows.length === 0) return null;
        if (rows[0].version !== expectedVersion) {
          return { conflict: true, current: normalize(rows[0]) };
        }
        return { item: normalize(rows[0]) };
      }

      fields.push(`version = version + 1`);
      fields.push(`updated_at = now()`);
      const versionParam = i++;
      const idParam = i++;
      values.push(expectedVersion, id);
      const sql = `UPDATE items SET ${fields.join(', ')} WHERE id = $${idParam} AND version = $${versionParam} RETURNING *`;
      const { rows } = await pool.query(sql, values);
      if (rows.length > 0) return { item: normalize(rows[0]) };

      // No rows updated: either the item doesn't exist, or the version didn't
      // match (lost the race / stale client). Disambiguate with a re-fetch.
      const { rows: currentRows } = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
      if (currentRows.length === 0) return null;
      return { conflict: true, current: normalize(currentRows[0]) };
    },

    async delete(id) {
      const { rowCount } = await pool.query('DELETE FROM items WHERE id = $1', [id]);
      return rowCount > 0;
    }
  };
}
