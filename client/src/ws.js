// client/src/ws.js
export function connectLiveUpdates(onMessage) {
  let socket = null;
  let reconnectTimer = null;

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
    socket.addEventListener('message', (event) => {
      try { onMessage(JSON.parse(event.data)); } catch { /* ignore malformed message */ }
    });
    socket.addEventListener('close', () => {
      reconnectTimer = setTimeout(connect, 2000);
    });
  }

  connect();

  return function disconnect() {
    clearTimeout(reconnectTimer);
    socket?.close();
  };
}
