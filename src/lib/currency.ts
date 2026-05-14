import Decimal from 'decimal.js';

export type CurrencyValue = number | string | Decimal | null | undefined;

interface FormatCurrencyOptions {
  decimals?: number;
  symbol?: string;
}

export function formatCurrency(value: CurrencyValue, options: FormatCurrencyOptions = {}): string {
  const { decimals = 2, symbol = '$' } = options;
  if (value == null) return `${symbol}0${decimals > 0 ? '.' + '0'.repeat(decimals) : ''}`;
  let d: Decimal;
  try {
    d = new Decimal(value as Decimal.Value);
  } catch {
    return `${symbol}0${decimals > 0 ? '.' + '0'.repeat(decimals) : ''}`;
  }
  if (!d.isFinite()) {
    return `${symbol}0${decimals > 0 ? '.' + '0'.repeat(decimals) : ''}`;
  }
  return `${symbol}${d.toFixed(decimals)}`;
}

export function toDecimal(value: CurrencyValue): Decimal {
  if (value == null) return new Decimal(0);
  try {
    const d = new Decimal(value as Decimal.Value);
    return d.isFinite() ? d : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}
