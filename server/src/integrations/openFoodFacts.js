// Thin wrapper around Open Food Facts's public product API (no API key
// required). Isolated here so the provider can be swapped later without
// touching barcodeService.js's lookup logic.
const BASE_URL = 'https://world.openfoodfacts.org/api/v2/product';

export async function lookupProduct(barcode) {
  try {
    const res = await fetch(`${BASE_URL}/${encodeURIComponent(barcode)}.json`);
    if (!res.ok) return null;

    const data = await res.json();
    const name = data?.product?.product_name;
    if (data?.status !== 1 || !name) return null;

    return { name, category: null };
  } catch {
    return null;
  }
}
