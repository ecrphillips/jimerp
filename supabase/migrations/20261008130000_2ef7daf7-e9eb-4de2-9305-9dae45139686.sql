-- get_client_green_detail follow-up: a lot counts as received once it has a
-- received_date, not only when status = 'RECEIVED'. Lots that have arrived but
-- are still being costed sit in COSTING_INCOMPLETE and were being shown to
-- clients as "arriving". Adds a `received` flag the client UI keys off.

CREATE OR REPLACE FUNCTION public._client_green_lot_json(p_lot_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'lot_id', l.id,
    'lot_number', l.lot_number,
    'coffee_name', c.name,
    'status', l.status,
    'received', r.received,
    'is_placeholder', l.is_placeholder,
    'origin_country', COALESCE(c.origin_country, pl.origin_country),
    'origin', c.origin,
    'region', COALESCE(c.region, pl.region),
    'producer', COALESCE(c.producer, pl.producer),
    'variety', COALESCE(c.variety, pl.variety),
    'crop_year', COALESCE(c.crop_year, pl.crop_year),
    'notes', l.member_facing_notes,
    'received_date', l.received_date,
    'expected_delivery_date', l.expected_delivery_date,
    -- Same 10 kg threshold the internal depletion warning uses.
    'running_low', (r.received AND l.kg_on_hand > 0 AND l.kg_on_hand <= 10),
    'depleted', (r.received AND l.kg_on_hand <= 0)
  )
  FROM public.green_lots l
  CROSS JOIN LATERAL (
    SELECT (l.status = 'RECEIVED' OR l.received_date IS NOT NULL) AS received
  ) r
  LEFT JOIN public.green_contracts c ON c.id = l.contract_id
  LEFT JOIN LATERAL (
    SELECT x.origin_country, x.region, x.producer, x.variety, x.crop_year
    FROM public.green_purchase_lines x
    WHERE x.lot_id = l.id
    ORDER BY x.display_order
    LIMIT 1
  ) pl ON true
  WHERE l.id = p_lot_id;
$$;

REVOKE ALL ON FUNCTION public._client_green_lot_json(uuid) FROM PUBLIC, anon, authenticated;
