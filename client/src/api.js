export async function getItems(listId = 'default') {
  const res = await fetch(`/api/lists/${encodeURIComponent(listId)}/items`);
  if (!res.ok) throw new Error('Failed to fetch items');
  return res.json();
}

export async function addItem({ name, qty = '', note = '', listId = 'default' }) {
  const res = await fetch(`/api/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, qty, note, listId })
  });
  if (!res.ok) throw new Error('Failed to add item');
  return res.json();
}

export async function updateItem(id, changes) {
  const res = await fetch(`/api/items/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes)
  });
  if (!res.ok) throw new Error('Failed to update item');
  return res.json();
}

export async function deleteItem(id) {
  const res = await fetch(`/api/items/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error('Failed to delete item');
}
