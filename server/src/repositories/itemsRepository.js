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
        const cases = CATEGORIES.map((c, i) => `WHEN '${c}' THEN ${i}`).join(' ');
        orderBy = `CASE category ${cases} ELSE ${CATEGORIES.length} END ASC, name COLLATE "C" ASC`;
      }
      const { rows } = await pool.query(
        `SELECT * FROM items WHERE household_id = $1 ORDER BY ${orderBy}`,
        [householdId]
      );
      return rows.map(normalize);
    },

    async getById(id) {
      const { rows } = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
      return rows[0] ? normalize(rows[0]) : null;
    },

    async insert({ id, householdId, name, qty, note, category }) {
      const cat = isValidCategory(category) ? category : 'General Food';
      const { rows: posRows } = await pool.query(
        'SELECT COALESCE(MAX(position), 0) AS maxp FROM items WHERE household_id = $1',
        [householdId]
      );
      const position = Number(posRows[0].maxp) + 1;
      const { rows } = await pool.query(
        `INSERT INTO items (id, household_id, name, qty, note, category, position, is_checked, version, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, 1, now())
         RETURNING *`,
        [id, householdId, name.trim(), qty || '', note || '', cat, position]
      );
      return normalize(rows[0]);
    },

    // Returns { conflict: true, current } if expectedVersion doesn't match,
    // otherwise { item: <updated row> }.
    async update(id, patch, expectedVersion) {
      const current = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
      if (current.rows.length === 0) return null;
      if (current.rows[0].version !== expectedVersion) {
        return { conflict: true, current: normalize(current.rows[0]) };
      }

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
      if (fields.length === 0) return { item: normalize(current.rows[0]) };

      fields.push(`version = version + 1`);
      fields.push(`updated_at = now()`);
      const sql = `UPDATE items SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`;
      values.push(id);
      const { rows } = await pool.query(sql, values);
      return { item: normalize(rows[0]) };
    },

    async delete(id) {
      const { rowCount } = await pool.query('DELETE FROM items WHERE id = $1', [id]);
      return rowCount > 0;
    }
  };
}
