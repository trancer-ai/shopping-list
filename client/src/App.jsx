import React, { useEffect, useState, useMemo } from 'react';
import { getItems, addItem, updateItem, deleteItem } from './api.js';

// --- floating status badge (only offline) ---
function OnlineBadge() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (online) return null; // hide when online

  return (
    <div style={{
      position: 'absolute',
      top: 12,
      right: 12,
      padding: '4px 10px',
      borderRadius: 8,
      fontSize: 12,
      background: '#ffe9e9',
      color: '#8a0000',
      border: '1px solid #f4c9c9',
      zIndex: 1000
    }}>
      Offline
    </div>
  );
}

export default function App() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', qty: '', note: '' });

  async function refresh() {
    try {
      setLoading(true);
      const data = await getItems('default');
      setItems(data);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function onAdd(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    const created = await addItem({ ...form, listId: 'default' });
    setItems(prev => [...prev, created]);
    setForm({ name: '', qty: '', note: '' });
  }

  async function toggleChecked(item) {
    const updated = await updateItem(item.id, { isChecked: !item.isChecked });
    setItems(prev => prev.map(it => it.id === item.id ? updated : it));
  }

  async function remove(id) {
    await deleteItem(id);
    setItems(prev => prev.filter(it => it.id !== id));
  }

  async function move(item, delta) {
    const idx = items.findIndex(i => i.id === item.id);
    const newIdx = Math.max(0, Math.min(items.length - 1, idx + delta));
    if (newIdx === idx) return;
    const newList = items.slice();
    newList.splice(idx, 1);
    newList.splice(newIdx, 0, item);
    const updates = newList.map((it, i) => ({ id: it.id, position: i + 1 }));
    await Promise.all(updates.map(u => updateItem(u.id, { position: u.position })));
    setItems(await getItems('default'));
  }

  const remaining = useMemo(() => items.filter(i => !i.isChecked).length, [items]);

  return (
    <div className="container" style={{ position: 'relative' }}>
      <OnlineBadge />
      <header>
        <h1>Shopping List</h1>
        <p>{remaining} item(s) remaining</p>
      </header>

      <form onSubmit={onAdd} className="card">
        <div className="row">
          <input
            placeholder="Item name"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div className="row">
          <input
            placeholder="Qty (optional)"
            value={form.qty}
            onChange={e => setForm({ ...form, qty: e.target.value })}
          />
          <input
            placeholder="Note (optional)"
            value={form.note}
            onChange={e => setForm({ ...form, note: e.target.value })}
          />
        </div>
        <button type="submit">Add</button>
      </form>

      {loading && <p>Loading…</p>}
      {error && <p className="error">{error}</p>}

      <ul className="list">
        {items.map((item) => (
          <li key={item.id} className={item.isChecked ? 'checked' : ''}>
            <label>
              <input
                type="checkbox"
                checked={item.isChecked}
                onChange={() => toggleChecked(item)}
              />
              <span className="name">{item.name}</span>
              {item.qty && <span className="meta"> · {item.qty}</span>}
              {item.note && <span className="meta"> · {item.note}</span>}
            </label>
            <div className="actions">
              <button onClick={() => move(item, -1)} aria-label="Move up">↑</button>
              <button onClick={() => move(item, +1)} aria-label="Move down">↓</button>
              <button onClick={() => remove(item.id)} aria-label="Delete">✕</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}