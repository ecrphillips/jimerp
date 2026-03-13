CREATE OR REPLACE FUNCTION public.decrement_lot_kg(p_lot_id uuid, p_kg numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.green_lots
  SET kg_on_hand = GREATEST(0, kg_on_hand - p_kg),
      updated_at = now()
  WHERE id = p_lot_id;
END;
$$;