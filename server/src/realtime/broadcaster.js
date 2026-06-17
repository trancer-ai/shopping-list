const OPEN = 1;

export function createBroadcaster() {
  const householdSockets = new Map(); // householdId -> Set<socket>

  return {
    subscribe(householdId, socket) {
      if (!householdSockets.has(householdId)) householdSockets.set(householdId, new Set());
      householdSockets.get(householdId).add(socket);
    },
    unsubscribe(householdId, socket) {
      householdSockets.get(householdId)?.delete(socket);
    },
    broadcast(householdId, message, { exclude } = {}) {
      const sockets = householdSockets.get(householdId);
      if (!sockets) return;
      const payload = JSON.stringify(message);
      for (const socket of sockets) {
        if (socket === exclude) continue;
        if (socket.readyState !== OPEN) continue;
        socket.send(payload);
      }
    }
  };
}
