// Local types for market-price-audit until supabase types.ts is regenerated.

export interface MarketPriceAuditRun {
  id: string;
  run_date: string;        // ISO date (YYYY-MM-DD)
  uploaded_by: string | null;
  uploaded_at: string;
  source_filename: string | null;
  notes: string | null;
  is_published: boolean;
}

export interface MarketPriceAuditRow {
  id: string;
  run_id: string;
  brand: string;
  product_name: string;
  product_url: string | null;
  bag_size_g: number | null;
  price_cad: number | null;
  price_per_g_cad: number | null;
  status: string;
  notes: string | null;
  created_at: string;
}

/** Shape used by the CSV upload preview + the import RPC payload. */
export interface MarketPriceAuditDraftRow {
  brand: string;
  product_name: string;
  product_url: string | null;
  bag_size_g: number | null;
  price_cad: number | null;
  price_per_g_cad: number | null;
  status: string;
  notes: string | null;
  // CSV-side warnings, never persisted.
  warnings?: string[];
}
