import { supabase } from '@/integrations/supabase/client';

/**
 * Two-tier lot identification for Purchases & Releases.
 *
 *   PO number  : HIC-{####}                                e.g. HIC-0001
 *   Lot number : {VENDOR_ABBR}-P{####}-{ISO3}-L{####}      e.g. ROY-P0001-COL-L0001
 *
 * Sequences are stored in `public.sourcing_sequences` (keys: 'po_sequence', 'lot_sequence')
 * and allocated atomically through the SECURITY DEFINER RPC `allocate_sourcing_sequence`.
 *
 * Existing PO/lot numbers with the old format are NOT auto-corrected — only newly created
 * Purchases / Releases use this generator.
 *
 * Note: Lot numbers still embed the legacy {VENDOR_ABBR}-P{####} segment derived from the
 * vendor + PO sequence digits, independent of the PO display format.
 */

const VENDOR_FALLBACK = '???';
const ORIGIN_FALLBACK = 'UNK';

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function normalizeVendor(abbr: string | null | undefined): string {
  const v = (abbr || '').toUpperCase().trim();
  return v || VENDOR_FALLBACK;
}

function normalizeOrigin(code: string | null | undefined): string {
  const v = (code || '').toUpperCase().trim();
  // Accept any 3-letter ISO3 code as-is; otherwise fall back.
  if (/^[A-Z]{3}$/.test(v)) return v;
  return ORIGIN_FALLBACK;
}

/** Atomically reserve `count` consecutive values for the given sequence key. */
async function allocateSequence(key: 'po_sequence' | 'lot_sequence', count = 1): Promise<number> {
  const { data, error } = await supabase.rpc('allocate_sourcing_sequence', {
    _key: key,
    _count: count,
  });
  if (error) throw error;
  const start = typeof data === 'number' ? data : Number(data);
  if (!Number.isFinite(start) || start < 1) {
    throw new Error('Sequence allocation returned invalid value');
  }
  return start;
}

export interface AllocatedPo {
  poNumber: string;        // e.g. ROY-P0001
  poDigits: string;        // e.g. 0001
  vendorAbbr: string;      // normalized
}

export interface AllocatedLot {
  lotNumber: string;       // e.g. ROY-P0001-COL-L0001
}

/**
 * Allocate the next PO number.
 *
 * New format: `HIC-{####}` (e.g. HIC-0001). The counter never resets and is shared
 * across all vendors. Vendor abbreviation is still captured on the returned object
 * so lot numbers can continue to embed the legacy {VENDOR_ABBR}-P{####} segment.
 */
export async function allocatePoNumber(vendorAbbreviation: string | null | undefined): Promise<AllocatedPo> {
  const vendorAbbr = normalizeVendor(vendorAbbreviation);
  const seq = await allocateSequence('po_sequence', 1);
  const poDigits = pad(seq, 4);
  return {
    poNumber: `HIC-${poDigits}`,
    poDigits,
    vendorAbbr,
  };
}

/**
 * Allocate `count` consecutive lot numbers under a PO. Returns a function that
 * builds the lot number for a given origin + index (0..count-1). Caller decides
 * which origin maps to which slot.
 */
export async function allocateLotNumbers(
  po: AllocatedPo,
  originCodes: Array<string | null | undefined>,
): Promise<AllocatedLot[]> {
  const count = originCodes.length;
  if (count <= 0) return [];
  const start = await allocateSequence('lot_sequence', count);
  return originCodes.map((code, i) => {
    const iso3 = normalizeOrigin(code);
    const lotSeq = pad(start + i, 4);
    return { lotNumber: `${po.vendorAbbr}-P${po.poDigits}-${iso3}-L${lotSeq}` };
  });
}

/** Allocate a single lot number under an existing PO. */
export async function allocateSingleLotNumber(
  po: AllocatedPo,
  originCode: string | null | undefined,
): Promise<string> {
  const [lot] = await allocateLotNumbers(po, [originCode]);
  return lot.lotNumber;
}

/**
 * Reconstruct a `AllocatedPo` from an existing po_number string + vendor abbr.
 * Used in EDIT flows where a purchase/release already has a PO and we just need
 * to allocate additional lot numbers under it.
 *
 * If the po_number doesn't match the new format, we fall back to allocating a
 * fresh PO so new lots still get well-formed numbers.
 */
export async function poFromExisting(
  existingPoNumber: string | null | undefined,
  vendorAbbreviation: string | null | undefined,
): Promise<AllocatedPo> {
  const vendorAbbr = normalizeVendor(vendorAbbreviation);
  const m = (existingPoNumber || '').match(/-P(\d{3,})$/);
  if (m) {
    return {
      poNumber: existingPoNumber!,
      poDigits: m[1].padStart(4, '0'),
      vendorAbbr,
    };
  }
  return allocatePoNumber(vendorAbbreviation);
}

// ──────────────────────────────────────────────────────────────────────────
// LEGACY EXPORT (back-compat) — old single-call API used by some callers.
// New code should use allocatePoNumber + allocateLotNumbers.
// This wrapper allocates a fresh PO + 1 lot under it.
// ──────────────────────────────────────────────────────────────────────────
export async function generateLotNumber(
  vendorAbbreviation: string | null | undefined,
  originCountryCode: string | null | undefined,
): Promise<string> {
  const po = await allocatePoNumber(vendorAbbreviation);
  return allocateSingleLotNumber(po, originCountryCode);
}
