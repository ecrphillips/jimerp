export type TaxCode = 'NONE' | 'GST5' | 'HST13' | 'HST14' | 'HST15';
export type ProductTaxCode = TaxCode | 'BY_PROVINCE';

export const TAX_CODES: Record<TaxCode, { label: string; rate: number }> = {
  NONE: { label: 'No tax', rate: 0 },
  GST5: { label: '5% GST', rate: 0.05 },
  HST13: { label: '13% HST', rate: 0.13 },
  HST14: { label: '14% HST', rate: 0.14 },
  HST15: { label: '15% HST', rate: 0.15 },
};

export const TAX_CODE_OPTIONS = Object.keys(TAX_CODES) as TaxCode[];

const PROVINCE_TAX: Record<string, TaxCode> = {
  BC: 'GST5', AB: 'GST5', MB: 'GST5', SK: 'GST5', QC: 'GST5', NT: 'GST5', NU: 'GST5', YT: 'GST5',
  ON: 'HST13', NS: 'HST14', NB: 'HST15', NL: 'HST15', PE: 'HST15',
};

const PROVINCE_NAMES: Record<string, string> = {
  'british columbia': 'BC', alberta: 'AB', manitoba: 'MB', saskatchewan: 'SK', quebec: 'QC', 'québec': 'QC',
  'northwest territories': 'NT', nunavut: 'NU', yukon: 'YT', ontario: 'ON', 'nova scotia': 'NS',
  'new brunswick': 'NB', 'newfoundland and labrador': 'NL', newfoundland: 'NL', 'prince edward island': 'PE',
};

export const TAX_GUIDANCE = [
  'BC, AB, MB, SK, QC, NT, NU, YT — charge 5% GST',
  'ON — charge 13% HST',
  'NS — charge 14% HST',
  'NB, NL, PE — charge 15% HST',
  'International — charge customs and duties as a separate line item',
];

/** Pull a Canadian province code out of free-text address or region field. */
export function provinceFromAddress(text: string | null | undefined): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [name, code] of Object.entries(PROVINCE_NAMES)) {
    if (lower.includes(name)) return code;
  }
  const tokens = text.toUpperCase().match(/\b[A-Z]{2}\b/g) ?? [];
  for (const t of tokens.reverse()) if (PROVINCE_TAX[t]) return t;
  return null;
}

export interface TaxSuggestion {
  code: TaxCode;
  province: string | null;
  international: boolean;
  message: string;
}

export function suggestTaxCode(province: string | null, country?: string | null): TaxSuggestion {
  const c = (country ?? '').trim().toUpperCase();
  if (c && !['CA', 'CAN', 'CANADA'].includes(c)) {
    return { code: 'NONE', province: null, international: true, message: 'Shipping internationally — no tax; add customs/duties as a separate line' };
  }
  if (province && PROVINCE_TAX[province]) {
    const code = PROVINCE_TAX[province];
    return { code, province, international: false, message: `Shipping to ${province} — suggested ${TAX_CODES[code].label}` };
  }
  return { code: 'GST5', province: null, international: false, message: 'No address on file — defaulting to 5% GST' };
}

export function resolveTaxCode(code: string | null | undefined, suggestion: TaxSuggestion): TaxCode {
  if (code === 'BY_PROVINCE') return suggestion.code;
  if (code && code in TAX_CODES) return code as TaxCode;
  return 'NONE';
}

export interface TaxableLine { amount: number; taxCode: TaxCode }
export interface TaxBreakdown { subtotal: number; taxes: { code: TaxCode; label: string; amount: number }[]; total: number }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeTaxBreakdown(lines: TaxableLine[]): TaxBreakdown {
  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const byCode = new Map<TaxCode, number>();
  for (const l of lines) {
    if (l.taxCode === 'NONE') continue;
    byCode.set(l.taxCode, (byCode.get(l.taxCode) ?? 0) + l.amount);
  }
  const taxes = TAX_CODE_OPTIONS.filter((c) => byCode.has(c)).map((code) => ({
    code, label: TAX_CODES[code].label, amount: r2(byCode.get(code)! * TAX_CODES[code].rate),
  }));
  return { subtotal, taxes, total: r2(subtotal + taxes.reduce((s, t) => s + t.amount, 0)) };
}
