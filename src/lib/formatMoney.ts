/**
 * Format a dollar amount with thousands separators and 2 decimal places.
 * Use for all monetary values EXCEPT per-weight rates.
 * Examples: CAD $1,234.56 | USD $9,999.00
 */
export function formatMoney(value: number, currency: 'CAD' | 'USD' = 'CAD'): string {
  return `${currency} $${value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format a per-kg rate to 4 decimal places. No thousands separator.
 * Use for book value, market value, contracted price, and any other $/kg or $/lb display.
 * Examples: CAD $1.2345/kg | USD $3.4567/kg
 */
export function formatPerKg(value: number, currency: 'CAD' | 'USD' = 'CAD'): string {
  return `${currency} $${value.toFixed(4)}/kg`;
}

/**
 * Format a per-lb rate to 4 decimal places. No thousands separator.
 * Examples: CAD $0.5612/lb | USD $0.4321/lb
 */
export function formatPerLb(value: number, currency: 'CAD' | 'USD' = 'CAD'): string {
  return `${currency} $${value.toFixed(4)}/lb`;
}
