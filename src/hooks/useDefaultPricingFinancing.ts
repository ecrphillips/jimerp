// Placeholder financing assumptions.
//
// These are hardcoded constants, NOT sourced from any pricing profile.
// isFromDefaultProfile is false so SourcingLots renders the honest
// "placeholder" caption rather than crediting a profile that does not exist.
// Slated to move into the editable pricing assumptions table.
export interface DefaultPricingFinancing {
  financing_days: number;
  financing_apr_pct: number;
  isFromDefaultProfile: boolean;
}

export const FALLBACK_FINANCING: DefaultPricingFinancing = {
  financing_days: 60,
  financing_apr_pct: 12,
  isFromDefaultProfile: false,
};

export function useDefaultPricingFinancing() {
  return { data: FALLBACK_FINANCING, isLoading: false };
}
