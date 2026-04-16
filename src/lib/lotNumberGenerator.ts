import { supabase } from '@/integrations/supabase/client';

/**
 * Generates a lot number in the format: {VENDOR_ABBR}-{ORIGIN_COUNTRY}-PO{###}
 *
 * The PO sequence is per (vendor + origin) combination. It is computed by
 * counting existing lots in `green_lots` whose `lot_number` matches the
 * `{VENDOR_ABBR}-{ORIGIN_COUNTRY}-PO%` prefix and adding 1, zero-padded to 3.
 *
 * Existing lots with malformed (non-matching) numbers are ignored — they will
 * not be touched, but they also do not consume a sequence slot.
 *
 * Falls back to '???' for missing vendor abbreviation or origin code so callers
 * never crash; callers should ideally validate inputs upstream.
 */
export async function generateLotNumber(
  vendorAbbreviation: string | null | undefined,
  originCountryCode: string | null | undefined,
): Promise<string> {
  const vendorAbbr = (vendorAbbreviation || '???').toUpperCase().trim();
  const origin = (originCountryCode || '???').toUpperCase().trim();
  const prefix = `${vendorAbbr}-${origin}-PO`;

  let nextNum = 1;
  try {
    const { data, error } = await supabase
      .from('green_lots')
      .select('lot_number')
      .like('lot_number', `${prefix}%`);
    if (!error && Array.isArray(data)) {
      // Extract the highest existing PO number for this prefix
      const re = new RegExp(`^${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(\\d+)$`);
      let maxNum = 0;
      for (const row of data) {
        const ln = (row as any).lot_number as string | null;
        if (!ln) continue;
        const m = ln.match(re);
        if (m) {
          const n = parseInt(m[1], 10);
          if (!isNaN(n) && n > maxNum) maxNum = n;
        }
      }
      nextNum = maxNum + 1;
    }
  } catch {
    // Fallback: nextNum = 1
  }

  return `${prefix}${String(nextNum).padStart(3, '0')}`;
}
