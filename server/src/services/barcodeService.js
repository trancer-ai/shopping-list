export function createBarcodeService(repository, lookupPublicProduct) {
  return {
    async lookup(householdId, barcode) {
      const household = await repository.getByBarcode(householdId, barcode);
      if (household) {
        return { found: true, name: household.name, category: household.category, note: household.note || null, source: 'household' };
      }

      let publicResult = null;
      try {
        publicResult = await lookupPublicProduct(barcode);
      } catch {
        publicResult = null;
      }

      if (publicResult) {
        return { found: true, name: publicResult.name, category: publicResult.category, note: publicResult.note || null, source: 'public' };
      }

      return { found: false, name: null, category: null, note: null, source: null };
    }
  };
}
