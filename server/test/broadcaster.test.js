import test from 'node:test';
import assert from 'node:assert/strict';
import { createBroadcaster } from '../src/realtime/broadcaster.js';

function fakeSocket() {
  return { readyState: 1 /* OPEN */, sent: [], send(msg) { this.sent.push(msg); } };
}

test('broadcasts a message to all sockets in the same household', () => {
  const broadcaster = createBroadcaster();
  const a = fakeSocket();
  const b = fakeSocket();
  broadcaster.subscribe('house-1', a);
  broadcaster.subscribe('house-1', b);

  broadcaster.broadcast('house-1', { type: 'item.created', item: { id: 'x' } });

  assert.equal(a.sent.length, 1);
  assert.equal(b.sent.length, 1);
  assert.deepEqual(JSON.parse(a.sent[0]), { type: 'item.created', item: { id: 'x' } });
});

test('does not send to sockets in a different household', () => {
  const broadcaster = createBroadcaster();
  const a = fakeSocket();
  broadcaster.subscribe('house-1', a);

  broadcaster.broadcast('house-2', { type: 'item.created', item: { id: 'x' } });

  assert.equal(a.sent.length, 0);
});

test('excludes a given socket from the broadcast when requested', () => {
  const broadcaster = createBroadcaster();
  const a = fakeSocket();
  const b = fakeSocket();
  broadcaster.subscribe('house-1', a);
  broadcaster.subscribe('house-1', b);

  broadcaster.broadcast('house-1', { type: 'item.created' }, { exclude: a });

  assert.equal(a.sent.length, 0);
  assert.equal(b.sent.length, 1);
});

test('stops sending to a socket after unsubscribe', () => {
  const broadcaster = createBroadcaster();
  const a = fakeSocket();
  broadcaster.subscribe('house-1', a);
  broadcaster.unsubscribe('house-1', a);

  broadcaster.broadcast('house-1', { type: 'item.created' });

  assert.equal(a.sent.length, 0);
});
