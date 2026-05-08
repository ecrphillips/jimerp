-- Seed the placeholder FX rate setting used during green lot cost entry.
-- This rate is applied when any release cost is in USD (coffee price or shared costs).
-- It is a manually-maintained estimate, replaced at Confirm Costs time by the actual rate.
INSERT INTO public.app_settings (key, value_json)
VALUES ('placeholder_fx_rate_usd_to_cad', '{"rate": 1.38}'::jsonb)
ON CONFLICT (key) DO NOTHING;
