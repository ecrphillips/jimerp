-- Baskets — Phase 2: roast groups can take green from baskets.
--
-- roast_group_baskets: a roast group uses a basket as one of its green
-- sources, optionally with a percentage. A roast group may use baskets and
-- specific lots (green_lot_roast_group_links) together; existing lot links are
-- not touched.
--   - Deleting a roast group removes its basket rows.
--   - Deleting a basket a roast group uses is refused (ON DELETE RESTRICT),
--     backing up the guard on the Baskets screens.
-- RLS mirrors baskets: ADMIN/OPS full access, no client/member access.
--
-- get_client_green_detail: roast groups that use a basket show the basket's
-- active lots as "current" and its first lined-up lot as "next". Linked lots
-- show exactly as before.

CREATE TABLE public.roast_group_baskets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roast_group text NOT NULL REFERENCES public.roast_groups(roast_group) ON DELETE CASCADE,
  basket_id uuid NOT NULL REFERENCES public.baskets(id) ON DELETE RESTRICT,
  pct numeric,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CONSTRAINT roast_group_baskets_rg_basket_unique UNIQUE (roast_group, basket_id)
);

COMMENT ON COLUMN public.roast_group_baskets.pct IS
  'Share of the roast group''s green from this basket; NULL = not set';

CREATE INDEX idx_roast_group_baskets_basket_id ON public.roast_group_baskets (basket_id);

ALTER TABLE public.roast_group_baskets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Ops can manage roast_group_baskets" ON public.roast_group_baskets
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anon roast_group_baskets" ON public.roast_group_baskets
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- ── Client green detail: include basket lots ─────────────────────────────
-- Same as 20261008120000 except the per-component `lots` list, which now also
-- includes basket-sourced lots after the directly linked ones.
CREATE OR REPLACE FUNCTION public.get_client_green_detail(p_account_id uuid, p_roast_group text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rg public.roast_groups;
  v_components jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'ADMIN'::public.app_role)
    OR public.has_role(auth.uid(), 'OPS'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = p_account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Only roast groups this account actually buys.
  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.roast_group = p_roast_group
      AND p.is_active
      AND (
        p.account_id = p_account_id
        OR EXISTS (
          SELECT 1 FROM public.client_allowed_products cap
          WHERE cap.account_id = p_account_id AND cap.product_id = p.id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_rg FROM public.roast_groups WHERE roast_group = p_roast_group;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;

  -- A blend resolves to its components; a single origin is its own component.
  WITH comps AS (
    SELECT rgc.component_roast_group AS rg, rgc.pct, rgc.display_order
    FROM public.roast_group_components rgc
    WHERE rgc.parent_roast_group = p_roast_group
    UNION ALL
    SELECT p_roast_group, 100::numeric, 0
    WHERE NOT EXISTS (
      SELECT 1 FROM public.roast_group_components
      WHERE parent_roast_group = p_roast_group
    )
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'roast_group', comps.rg,
           'display_name', COALESCE(crg.display_name, comps.rg),
           'pct', comps.pct,
           'lots', COALESCE((
             SELECT jsonb_agg(src.entry ORDER BY src.k1, src.k2, src.k3)
             FROM (
               -- Directly linked lots (unchanged behaviour).
               SELECT 0 AS k1, 0 AS k2, gl.created_at AS k3,
                      jsonb_build_object(
                        'current', public._client_green_lot_json(gl.lot_id),
                        'next', CASE WHEN gl.successor_lot_id IS NOT NULL
                                     THEN public._client_green_lot_json(gl.successor_lot_id)
                                END
                      ) AS entry
               FROM public.green_lot_roast_group_links gl
               WHERE gl.roast_group = comps.rg

               UNION ALL

               -- Basket active lots; the basket's first lined-up lot is "next"
               -- on its first active lot (or on its own when nothing is active).
               SELECT 1, rgb.display_order, act.created_at,
                      jsonb_build_object(
                        'current', public._client_green_lot_json(act.lot_id),
                        'next', CASE WHEN act.rn = 1 AND nx.lot_id IS NOT NULL
                                     THEN public._client_green_lot_json(nx.lot_id)
                                END
                      )
               FROM public.roast_group_baskets rgb
               CROSS JOIN LATERAL (
                 SELECT bl.lot_id, bl.created_at,
                        row_number() OVER (ORDER BY bl.active_pct DESC, bl.created_at) AS rn
                 FROM public.basket_lots bl
                 WHERE bl.basket_id = rgb.basket_id AND bl.active_pct IS NOT NULL
               ) act
               LEFT JOIN LATERAL (
                 SELECT bl.lot_id
                 FROM public.basket_lots bl
                 JOIN public.green_lots l ON l.id = bl.lot_id
                 WHERE bl.basket_id = rgb.basket_id AND bl.active_pct IS NULL
                 ORDER BY
                   CASE WHEN l.status <> 'EN_ROUTE' OR l.received_date IS NOT NULL THEN 0
                        WHEN l.is_placeholder THEN 2 ELSE 1 END,
                   CASE WHEN l.status <> 'EN_ROUTE' OR l.received_date IS NOT NULL THEN l.received_date
                        WHEN NOT l.is_placeholder THEN l.expected_delivery_date END NULLS LAST,
                   l.created_at, l.lot_number
                 LIMIT 1
               ) nx ON true
               WHERE rgb.roast_group = comps.rg

               UNION ALL

               SELECT 1, rgb.display_order, rgb.created_at,
                      jsonb_build_object(
                        'current', NULL,
                        'next', public._client_green_lot_json(nx.lot_id)
                      )
               FROM public.roast_group_baskets rgb
               CROSS JOIN LATERAL (
                 SELECT bl.lot_id
                 FROM public.basket_lots bl
                 JOIN public.green_lots l ON l.id = bl.lot_id
                 WHERE bl.basket_id = rgb.basket_id AND bl.active_pct IS NULL
                 ORDER BY
                   CASE WHEN l.status <> 'EN_ROUTE' OR l.received_date IS NOT NULL THEN 0
                        WHEN l.is_placeholder THEN 2 ELSE 1 END,
                   CASE WHEN l.status <> 'EN_ROUTE' OR l.received_date IS NOT NULL THEN l.received_date
                        WHEN NOT l.is_placeholder THEN l.expected_delivery_date END NULLS LAST,
                   l.created_at, l.lot_number
                 LIMIT 1
               ) nx
               WHERE rgb.roast_group = comps.rg
                 AND NOT EXISTS (
                   SELECT 1 FROM public.basket_lots a
                   WHERE a.basket_id = rgb.basket_id AND a.active_pct IS NOT NULL
                 )
             ) src
           ), '[]'::jsonb)
         ) ORDER BY comps.display_order), '[]'::jsonb)
  INTO v_components
  FROM comps
  LEFT JOIN public.roast_groups crg ON crg.roast_group = comps.rg;

  RETURN jsonb_build_object(
    'roast_group', v_rg.roast_group,
    'display_name', v_rg.display_name,
    'is_blend', v_rg.is_blend,
    'components', v_components
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_client_green_detail(uuid, text) FROM PUBLIC, anon;

-- New table: refresh PostgREST's schema cache so the API sees it.
NOTIFY pgrst, 'reload schema';
