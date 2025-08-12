import React, { useEffect, useState, useMemo } from 'react';
import { getItems, addItem, updateItem, deleteItem, replayQueue } from './api.js';

const CATS = [
  { key: 'F&V', color: '#2ecc71' },
  { key: 'Meat', color: '#e74c3c' },
  { key: 'Deli', color: '#f39c12' },
  { key: 'Bakery', color: '#d35400' },
  { key: 'General Food', color: '#3498db' },
  { key: 'Personal', color: '#9b59b6' },
  { key: 'Cleaning', color: '#16a085' },
  { key: 'Cold Things', color: '#1abc9c' },
];

const DEFAULT_CAT = 'General Food';
const KEY_TO_COLOR = Object.fromEntries(CATS.map(c => [c.key, c.color]));

export default function App() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', qty: '', note: '', category: DEFAULT_CAT });
  const [sort, setSort] = useState('category'); // 'category' | 'alpha' | 'recent' | '' (manual)

  // ✅ status badge state
  const [status, setStatus] = useState(navigator.onLine ? '' : 'Offline Mode');
  const [statusColor, setStatusColor] = useState(navigator.onLine ? '' : '#c62828'); // red

  async function refresh() {
    try {
      setLoading(true);
      const data = await getItems('default', sort);
      setItems(data);
      setError('');
    } catch (e) {
      setError(e.message || 'Failed to load items');
    } finally {
      setLoading(false);
    }
  }

  // initial + on sort change
  useEffect(() => { refresh(); }, [sort]);

  // ✅ online/offline listeners + sync on reconnect
  useEffect(() => {
    function goOffline() {
      setStatus('Offline Mode');
      setStatusColor('#c62828'); // red
    }
    async function goOnline() {
      try {
        await replayQueue();     // flush queued writes
        await refresh();         // pull server truth
        setStatus('Online (Synchronized)');
        setStatusColor('#2e7d32'); // green
        setTimeout(() => setStatus(''), 3000); // fade after 3s
      } catch {
        // If something failed, still show we're online but not synced
        setStatus('Online (Sync Pending)');
        setStatusColor('#ef6c00'); // orange
        setTimeout(() => setStatus(''), 4000);
      }
    }

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  async function onAdd(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    await addItem({ ...form, listId: 'default' });
    await refresh(); // respect current sort and reconcile optimistic items
    setForm({ name: '', qty: '', note: '', category: DEFAULT_CAT });
  }

  async function toggleChecked(item) {
    await updateItem(item.id, { isChecked: !item.isChecked });
    await refresh();
  }

  async function remove(id) {
    await deleteItem(id);
    await refresh();
  }

  async function move(item, delta) {
    // only meaningful when using manual order (sort == '')
    if (sort) return;
    const idx = items.findIndex(i => i.id === item.id);
    const newIdx = Math.max(0, Math.min(items.length - 1, idx + delta));
    if (newIdx === idx) return;

    const newList = items.slice();
    newList.splice(idx, 1);
    newList.splice(newIdx, 0, item);
    const updates = newList.map((it, i) => ({ id: it.id, position: i + 1 }));
    await Promise.all(updates.map(u => updateItem(u.id, { position: u.position })));
    await refresh();
  }

  const remaining = useMemo(() => items.filter(i => !i.isChecked).length, [items]);

  return (
    <div className="container">
      {/* ✅ status badge */}
      {status && (
        <div
          style={{
            position: 'fixed',
            top: 10,
            right: 10,
            backgroundColor: statusColor,
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 13,
            boxShadow: '0 2px 8px rgba(0,0,0,.15)',
            zIndex: 1000
          }}
        >
          {status}
        </div>
      )}

      <header>
        <h1>Shopping List</h1>
        <p>{remaining} item(s) remaining</p>

        <div className="row" style={{ marginLeft: 'auto', maxWidth: 380 }}>
          <label style={{ fontSize: 14, alignSelf: 'center' }}>Sort:&nbsp;</label>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
          >
            <option value="category">By category</option>
            <option value="alpha">Alphabetical</option>
            <option value="recent">Most recent</option>
            <option value="">Manual (position)</option>
          </select>
        </div>
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
        <div className="row">
          <select
            value={form.category}
            onChange={e => setForm({ ...form, category: e.target.value })}
            aria-label="Category"
          >
            {CATS.map(c => <option key={c.key} value={c.key}>{c.key}</option>)}
          </select>
          <button type="submit">Add</button>
        </div>
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
              <span className="cat-badge" style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                borderRadius: 6,
                marginRight: 8,
                fontSize: 12,
                color: '#fff',
                background: KEY_TO_COLOR[item.category] || '#999'
              }}>
                {item.category?.[0] || '·'}
              </span>
              <span className="name">{item.name}</span>
              {item.qty && <span className="meta"> · {item.qty}</span>}
              {item.note && <span className="meta"> · {item.note}</span>}
            </label>

            <div className="actions">
              <button onClick={() => move(item, -1)} aria-label="Move up" disabled={!!sort}>↑</button>
              <button onClick={() => move(item, +1)} aria-label="Move down" disabled={!!sort}>↓</button>
              <button onClick={() => remove(item.id)} aria-label="Delete">✕</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}