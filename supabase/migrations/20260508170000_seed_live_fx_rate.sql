-- Seed the live FX rate key populated daily by the fetch-fx-rate edge function.
-- Distinct from placeholder_fx_rate_usd_to_cad (manual estimate).
-- value_json shape: { rate: number, date: "YYYY-MM-DD", source: string, fetched_at: ISO string }
INSERT INTO public.app_settings (key, value_json)
VALUES (
  'fx_rate_usd_to_cad',
  '{"rate": 1.38, "date": null, "source": "seed", "fetched_at": null}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
