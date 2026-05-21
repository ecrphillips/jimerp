import { parseCsv } from '@/lib/csvParse';
import type { MarketPriceAuditDraftRow } from '@/lib/marketPricingTypes';

const REQUIRED_HEADERS = ['brand', 'product_name', 'price_cad', 'bag_size_g'];

export interface CsvParseResult {
  rows: MarketPriceAuditDraftRow[];
  detectedRunDate: string | null; // first non-empty run_date column we see
  headerMissing: string[];
}

/** Parse CSV text into draft rows ready for the import RPC, with per-row warnings. */
export function parseMarketAuditCsv(text: string): CsvParseResult {
  const { header, rows } = parseCsv(text);
  const headerLower = header.map(h => h.toLowerCase().trim());
  const idx = (name: string) => headerLower.indexOf(name);

  const headerMissing = REQUIRED_HEADERS.filter(h => idx(h) === -1);

  let detectedRunDate: string | null = null;
  const out: MarketPriceAuditDraftRow[] = [];

  for (const raw of rows) {
    if (raw.every(c => c.trim() === '')) continue;

    const get = (name: string): string => {
      const j = idx(name);
      return j >= 0 ? (raw[j] ?? '').trim() : '';
    };

    const brand = get('brand');
    const product_name = get('product_name');
    if (!brand && !product_name) continue;

    const product_url = get('product_url') || null;
    const bag_size_g = parseIntOrNull(get('bag_size_g'));
    const price_cad = parseNumOrNull(get('price_cad'));
    let price_per_g_cad = parseNumOrNull(get('price_per_g_cad'));
    if (price_per_g_cad == null && price_cad != null && bag_size_g && bag_size_g > 0) {
      price_per_g_cad = Number((price_cad / bag_size_g).toFixed(5));
    }
    const statusRaw = get('status').toLowerCase() || 'ok';
    const notes = get('notes') || null;

    const rdRaw = get('run_date');
    if (rdRaw && !detectedRunDate) detectedRunDate = normalizeDate(rdRaw);

    const warnings: string[] = [];
    if (!brand) warnings.push('brand missing');
    if (!product_name) warnings.push('product_name missing');
    if (price_cad == null) warnings.push('price_cad missing/invalid');
    if (bag_size_g == null || bag_size_g <= 0) warnings.push('bag_size_g missing/invalid');
    if (price_per_g_cad == null) warnings.push('price_per_g_cad missing');

    out.push({
      brand,
      product_name,
      product_url,
      bag_size_g,
      price_cad,
      price_per_g_cad,
      status: statusRaw,
      notes,
      warnings,
    });
  }

  return { rows: out, detectedRunDate, headerMissing };
}

function parseNumOrNull(s: string): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[$,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function parseIntOrNull(s: string): number | null {
  const n = parseNumOrNull(s);
  if (n == null) return null;
  return Math.round(n);
}
function normalizeDate(s: string): string | null {
  // Accept YYYY-MM-DD as-is; also try Date parsing as a fallback.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
