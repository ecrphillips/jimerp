// Stub — financing assumptions removed from the pricing model.
export interface DefaultPricingFinancing {
  financing_days: number;
  financing_apr_pct: number;
}

export const FALLBACK_FINANCING: DefaultPricingFinancing = {
  financing_days: 60,
  financing_apr_pct: 12,
};

export function useDefaultPricingFinancing() {
  return { data: FALLBACK_FINANCING, isLoading: false };
}
