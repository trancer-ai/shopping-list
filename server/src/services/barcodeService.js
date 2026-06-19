export function createBarcodeService(repository, lookupPublicProduct) {
  return {
    async lookup(householdId, barcode) {
      const household = await repository.getByBarcode(householdId, barcode);
      if (household) {
        return { found: true, name: household.name, category: household.category, source: 'household' };
      }

      let publicResult = null;
      try {
        publicResult = await lookupPublicProduct(barcode);
      } catch {
        publicResult = null;
      }

      if (publicResult) {
        return { found: true, name: publicResult.name, category: publicResult.category, source: 'public' };
      }

      return { found: false, name: null, category: null, source: null };
    }
  };
}
