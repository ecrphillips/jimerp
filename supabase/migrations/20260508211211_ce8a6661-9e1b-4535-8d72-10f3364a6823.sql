INSERT INTO public.app_settings (key, value_json)
VALUES (
  'fx_rate_usd_to_cad',
  '{"rate": 1.38, "date": null, "source": "seed", "fetched_at": null}'::jsonb
)
ON CONFLICT (key) DO NOTHING;