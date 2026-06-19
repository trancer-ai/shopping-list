// Thin wrapper around Open Food Facts's public product API (no API key
// required). Isolated here so the provider can be swapped later without
// touching barcodeService.js's lookup logic.
const BASE_URL = 'https://world.openfoodfacts.org/api/v2/product';

export async function lookupProduct(barcode) {
  try {
    const res = await fetch(`${BASE_URL}/${encodeURIComponent(barcode)}.json`);
    if (!res.ok) return null;

    const data = await res.json();
    const productName = data?.product?.product_name;
    if (data?.status !== 1 || !productName) return null;

    // `brands` is free text and correctly cased/accented; `brands_tags` is
    // normalized only for brands OFF recognizes in its taxonomy, so it mixes
    // lowercased and original-case entries unpredictably - not safe to display.
    const brand = data?.product?.brands?.split(',')[0]?.trim() || null;
    const alreadyHasBrand = brand && productName.toLowerCase().startsWith(brand.toLowerCase());
    const name = brand && !alreadyHasBrand ? `${brand} ${productName}` : productName;

    return { name, category: null, note: data?.product?.quantity || null };
  } catch {
    return null;
  }
}
