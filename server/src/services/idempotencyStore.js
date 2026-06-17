export function createIdempotencyStore({ ttlMs = 5 * 60 * 1000, clock = Date.now } = {}) {
  const entries = new Map(); // operationId -> { result, expiresAt }

  return {
    get(operationId) {
      const entry = entries.get(operationId);
      if (!entry) return undefined;
      if (clock() >= entry.expiresAt) {
        entries.delete(operationId);
        return undefined;
      }
      return entry.result;
    },
    set(operationId, result) {
      entries.set(operationId, { result, expiresAt: clock() + ttlMs });
    }
  };
}
