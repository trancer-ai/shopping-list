export function createItemsService(repository, idempotencyStore) {
  return {
    async createItem(operationId, { id, householdId, name, qty, note, category }) {
      const cached = idempotencyStore.get(operationId);
      if (cached) return cached;

      const item = await repository.insert({ id, householdId, name, qty, note, category });
      const result = { item };
      idempotencyStore.set(operationId, result);
      return result;
    },

    async updateItem(operationId, id, patch, expectedVersion) {
      const cached = idempotencyStore.get(operationId);
      if (cached) return cached;

      const result = await repository.update(id, patch, expectedVersion);
      if (!result) return null;
      idempotencyStore.set(operationId, result);
      return result;
    },

    async deleteItem(operationId, id) {
      const cached = idempotencyStore.get(operationId);
      if (cached) return cached;

      const deleted = await repository.delete(id);
      const result = { deleted };
      idempotencyStore.set(operationId, result);
      return result;
    },

    async listItems(householdId, sort) {
      return repository.list ? repository.list(householdId, sort) : [];
    }
  };
}
