import React, { useEffect, useState, useMemo } from 'react';
import { getItems, addItem, updateItem, deleteItem, replayQueue, getQueueLength } from './api.js';

const CATS = [
  { key: 'F&V', color: '#1fc422' },
  { key: 'Meat', color: '#c20e0e' },
  { key: 'Deli', color: '#e67074' },
  { key: 'Bakery', color: '#deb159' },
  { key: 'General Food', color: '#f0ec0a' },
  { key: 'Personal', color: '#ca34db' },
  { key: 'Cleaning', color: '#051ced' },
  { key: 'Cold Things', color: '#05c3ed' },
  { key: 'Utilities', color: '#440201ff' },
];

const DEFAULT_CAT = 'General Food';
const KEY_TO_COLOR = Object.fromEntries(CATS.map(c => [c.key, c.color]));

// Pick readable text color (black/white) given a hex background
function getContrastColor(hex) {
  try {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    // YIQ formula for perceived brightness
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 160 ? '#111' : '#fff';
  } catch {
    return '#fff';
  }
}

export default function App() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', qty: '', note: '', category: DEFAULT_CAT });
  const [sort, setSort] = useState('category'); // 'category' | 'alpha' | 'recent' | '' (manual)

  // status badge
  const [status, setStatus] = useState(navigator.onLine ? '' : 'Offline Mode');
  const [statusColor, setStatusColor] = useState(navigator.onLine ? '' : '#c62828'); // red

  // history for Undo (store last few snapshots)
  const [history, setHistory] = useState([]);

  function pushHistory() {
    // shallow copy items for snapshot
    setHistory(h => [items.map(i => ({ ...i })), ...h].slice(0, 5));
  }

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

  // online/offline listeners + sync on reconnect
  useEffect(() => {
    function goOffline() {
      setStatus('Offline Mode');
      setStatusColor('#c62828');
    }
    async function goOnline() {
      try {
        const remaining = await replayQueue(); // flush queued writes
        if (remaining === 0) {
          await refresh();                     // only refresh when fully flushed
          setStatus('Online (Synchronized)');
          setStatusColor('#2e7d32');
        } else {
          setStatus('Online (Sync Pending)');
          setStatusColor('#ef6c00');
        }
        setTimeout(() => setStatus(''), 3000);
      } catch {
        setStatus('Online (Sync Pending)');
        setStatusColor('#ef6c00');
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
    pushHistory();
    await addItem({ ...form, listId: 'default' });
    await refresh();
    setForm({ name: '', qty: '', note: '', category: DEFAULT_CAT });
  }

  async function toggleChecked(item) {
    pushHistory();
    await updateItem(item.id, { isChecked: !item.isChecked });
    await refresh();
  }

  async function remove(id) {
    pushHistory();
    await deleteItem(id);
    await refresh();
  }

  async function move(item, delta) {
    if (sort) return; // only meaningful when using manual order (sort == '')
    const idx = items.findIndex(i => i.id === item.id);
    const newIdx = Math.max(0, Math.min(items.length - 1, idx + delta));
    if (newIdx === idx) return;

    pushHistory();
    const newList = items.slice();
    newList.splice(idx, 1);
    newList.splice(newIdx, 0, item);
    const updates = newList.map((it, i) => ({ id: it.id, position: i + 1 }));
    await Promise.all(updates.map(u => updateItem(u.id, { position: u.position })));
    await refresh();
  }

  async function manualSync() {
    try {
      const remaining = await replayQueue();
      if (remaining === 0) {
        await refresh();
        setStatus('Online (Manual Sync)');
        setStatusColor('#2e7d32');
      } else {
        setStatus('Sync Pending');
        setStatusColor('#ef6c00');
      }
      setTimeout(() => setStatus(''), 3000);
    } catch {
      setStatus('Sync failed');
      setStatusColor('#ef6c00');
      setTimeout(() => setStatus(''), 3000);
    }
  }

  async function undoLast() {
    const prev = history[0];
    if (!prev) return;
    setHistory(h => h.slice(1));

    const prevById = new Map(prev.map(i => [i.id, i]));
    const currById = new Map(items.map(i => [i.id, i]));
    const ops = [];

    for (const [id, prevItem] of prevById) {
      const curr = currById.get(id);
      if (!curr) continue;
      const patch = {};
      if (curr.name !== prevItem.name) patch.name = prevItem.name;
      if (curr.qty !== prevItem.qty) patch.qty = prevItem.qty;
      if (curr.note !== prevItem.note) patch.note = prevItem.note;
      if (curr.category !== prevItem.category) patch.category = prevItem.category;
      if (curr.isChecked !== prevItem.isChecked) patch.isChecked = prevItem.isChecked;
      if (curr.position !== prevItem.position) patch.position = prevItem.position;
      if (Object.keys(patch).length) ops.push(() => updateItem(id, patch));
    }

    for (const [id] of currById) {
      if (!prevById.has(id)) ops.push(() => deleteItem(id));
    }

    for (const [id, prevItem] of prevById) {
      if (currById.has(id)) continue;
      const body = {
        listId: prevItem.listId || 'default',
        name: prevItem.name,
        qty: prevItem.qty,
        note: prevItem.note,
        category: prevItem.category
      };
      ops.push(() => addItem(body));
    }

    for (const fn of ops) await fn();
    await refresh();

    // Toast: Undone
    setStatus('Undone');
    setStatusColor('#2e7d32');
    setTimeout(() => setStatus(''), 2000);
  }

  async function deleteChecked() {
    const ids = items.filter(i => i.isChecked).map(i => i.id);
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} checked item(s)?`)) return;
    pushHistory();
    await Promise.all(ids.map(id => deleteItem(id)));
    await refresh();
  }

  async function deleteAll() {
    if (!items.length) return;
    if (!confirm('Delete all items?')) return;
    pushHistory();
    await Promise.all(items.map(i => deleteItem(i.id)));
    await refresh();
  }

  const remaining = useMemo(() => items.filter(i => !i.isChecked).length, [items]);
  const hasChecked = useMemo(() => items.some(i => i.isChecked), [items]);

  return (
    <div className="container">
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

        <div className="row" style={{ marginLeft: 'auto', maxWidth: 620, alignItems: 'center' }}>
          <label style={{ fontSize: 14 }}>Sort:&nbsp;</label>
          <select value={sort} onChange={e => setSort(e.target.value)}>
            <option value="category">By category</option>
            <option value="alpha">Alphabetical</option>
            <option value="recent">Most recent</option>
            <option value="">Manual (position)</option>
          </select>

          <div className="actions" style={{ marginLeft: 'auto' }}>
            <button onClick={manualSync} aria-label="Sync now">⟳ Sync</button>
            <button onClick={undoLast} disabled={!history.length} aria-label="Undo last">↶ Undo</button>
            <button onClick={deleteChecked} disabled={!hasChecked} aria-label="Delete checked">🗑︎ Checked</button>
            <button onClick={deleteAll} disabled={!items.length} aria-label="Delete all">🗑︎ All</button>
          </div>
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
          <button
            type="submit"
            style={{
              background: KEY_TO_COLOR[form.category] || '#111',
              color: getContrastColor(KEY_TO_COLOR[form.category] || '#111')
            }}
          >
            Add
          </button>
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
              }} aria-label={item.category}>
                <span className="cat-icon" aria-hidden="true" />
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
