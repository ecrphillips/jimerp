-- Client portal pass.
--
--   1. orders.shipped_at — stamped by trigger whenever an order enters SHIPPED
--      (any write path), cleared when it is reverted out of SHIPPED.
--   2. Client order edits / change requests:
--        * SUBMITTED (and DRAFT) orders: client edits apply immediately.
--        * CONFIRMED / IN_PRODUCTION / READY: the edit is stored as a PENDING
--          order_change_requests row; staff approve (applies it) or decline.
--        * SHIPPED / CANCELLED: no edits.
--      All writes go through SECURITY DEFINER RPCs; clients get read-only RLS.
--   3. client_product_notes — per (account, roast group) notes written by the
--      client, visible to staff.
--   4. get_client_green_detail — client-safe green coffee detail (current lots
--      and nominated successors) for a roast group the account buys. No cost,
--      inventory or vendor data leaves the function.

-- New notification event: staff declined a client change request.
ALTER TYPE public.notification_event_type ADD VALUE IF NOT EXISTS 'ORDER_CHANGE_DECLINED';

-- ============================================================
-- 1. orders.shipped_at
-- ============================================================
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipped_at timestamptz;

COMMENT ON COLUMN public.orders.shipped_at IS
  'When the order entered SHIPPED. Maintained by trg_set_order_shipped_at; NULL unless status is SHIPPED (or CANCELLED after shipping).';

-- Backfill: latest SHIPPED transition from the audit log; orders shipped before
-- the audit log existed fall back to updated_at (best available estimate).
-- User triggers are disabled so the backfill does not bump updated_at.
ALTER TABLE public.orders DISABLE TRIGGER USER;

UPDATE public.orders o
SET shipped_at = a.shipped_at
FROM (
  SELECT order_id, max(changed_at) AS shipped_at
  FROM public.order_status_audit_log
  WHERE to_status = 'SHIPPED'::public.order_status
  GROUP BY order_id
) a
WHERE a.order_id = o.id
  AND o.status = 'SHIPPED'::public.order_status;

UPDATE public.orders
SET shipped_at = updated_at
WHERE status = 'SHIPPED'::public.order_status
  AND shipped_at IS NULL;

ALTER TABLE public.orders ENABLE TRIGGER USER;

CREATE OR REPLACE FUNCTION public.set_order_shipped_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'SHIPPED'::public.order_status THEN
    IF TG_OP = 'INSERT' THEN
      NEW.shipped_at := COALESCE(NEW.shipped_at, now());
    ELSIF OLD.status IS DISTINCT FROM 'SHIPPED'::public.order_status
          AND NEW.shipped_at IS NOT DISTINCT FROM OLD.shipped_at THEN
      NEW.shipped_at := now();
    END IF;
  ELSIF NEW.status <> 'CANCELLED'::public.order_status THEN
    -- Reverted out of SHIPPED (or never shipped). A cancelled-after-shipping
    -- order keeps its timestamp.
    NEW.shipped_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_order_shipped_at ON public.orders;
CREATE TRIGGER trg_set_order_shipped_at
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_order_shipped_at();

-- orders_all was created as SELECT o.* — the column list is frozen at creation,
-- so re-create it to pick up shipped_at (appended at the end; grants survive
-- CREATE OR REPLACE).
CREATE OR REPLACE VIEW public.orders_all
WITH (security_invoker = true)
AS
SELECT o.*
FROM public.orders o
WHERE public.has_role(auth.uid(), 'ADMIN'::public.app_role)
   OR public.has_role(auth.uid(), 'OPS'::public.app_role);

-- ============================================================
-- 2. Client order edits / change requests
-- ============================================================
CREATE TABLE IF NOT EXISTS public.order_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'DECLINED', 'WITHDRAWN', 'AUTO_APPLIED')),
  order_status_at_request public.order_status NOT NULL,
  -- Whitelisted change payload:
  --   { line_items: [{ line_item_id?, product_id, quantity_units }],
  --     requested_ship_date, delivery_method, client_po, client_notes }
  proposed jsonb NOT NULL,
  -- Order state when the request was made (same shape, line items carry names).
  snapshot jsonb NOT NULL,
  client_message text,
  requested_by uuid REFERENCES auth.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  resolution_note text
);

COMMENT ON TABLE public.order_change_requests IS
  'Client-initiated order edits. PENDING rows await staff review (confirmed+ orders); AUTO_APPLIED rows are an audit trail of edits a client made while the order was still SUBMITTED. Written only via client_edit_order / resolve_order_change_request / client_withdraw_order_change_request.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_change_requests_one_pending
  ON public.order_change_requests(order_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_order_change_requests_order_id
  ON public.order_change_requests(order_id, requested_at DESC);

ALTER TABLE public.order_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view order change requests" ON public.order_change_requests;
CREATE POLICY "Staff can view order change requests"
  ON public.order_change_requests
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'ADMIN'::public.app_role)
    OR public.has_role(auth.uid(), 'OPS'::public.app_role)
  );

DROP POLICY IF EXISTS "Account users can view own order change requests" ON public.order_change_requests;
CREATE POLICY "Account users can view own order change requests"
  ON public.order_change_requests
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = order_change_requests.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  ));

REVOKE ALL ON public.order_change_requests FROM PUBLIC, anon;
GRANT SELECT ON public.order_change_requests TO authenticated;

-- Current order state in change-payload shape (plus product names for display).
CREATE OR REPLACE FUNCTION public._order_change_snapshot(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'line_items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'line_item_id', oli.id,
               'product_id', oli.product_id,
               'product_name', p.product_name,
               'quantity_units', oli.quantity_units
             ) ORDER BY oli.created_at)
      FROM public.order_line_items oli
      JOIN public.products p ON p.id = oli.product_id
      WHERE oli.order_id = o.id
    ), '[]'::jsonb),
    'requested_ship_date', o.requested_ship_date,
    'delivery_method', o.delivery_method,
    'client_po', o.client_po,
    'client_notes', o.client_notes
  )
  FROM public.orders o
  WHERE o.id = p_order_id;
$$;

-- Applies a whitelisted change payload to an order. No auth or status checks —
-- callers (client_edit_order, resolve_order_change_request) own those. Not
-- executable by API roles.
CREATE OR REPLACE FUNCTION public._apply_order_changes(p_order_id uuid, p_changes jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_item jsonb;
  v_line_id uuid;
  v_product_id uuid;
  v_qty integer;
  v_picked integer;
  v_keep_ids uuid[] := '{}';
  v_primary_shipment_id uuid;
  v_primary_method public.delivery_method;
  v_restricted boolean;
  v_price numeric;
  v_method public.delivery_method;
  v_removed RECORD;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, delivery_method INTO v_primary_shipment_id, v_primary_method
  FROM public.order_shipments
  WHERE order_id = p_order_id
  ORDER BY shipment_number
  LIMIT 1;

  -- ---- Line items ----------------------------------------------------------
  IF p_changes ? 'line_items' THEN
    IF jsonb_typeof(p_changes->'line_items') <> 'array'
       OR jsonb_array_length(p_changes->'line_items') = 0 THEN
      RAISE EXCEPTION 'An order needs at least one item';
    END IF;

    v_restricted := EXISTS (
      SELECT 1 FROM public.client_allowed_products cap
      WHERE cap.account_id = v_order.account_id
    );

    -- Pass 1: validate every entry and collect the existing lines being kept.
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_changes->'line_items') LOOP
      v_qty := (v_item->>'quantity_units')::integer;
      IF v_qty IS NULL OR v_qty <= 0 THEN
        RAISE EXCEPTION 'Quantities must be whole numbers greater than zero';
      END IF;

      v_line_id := NULLIF(v_item->>'line_item_id', '')::uuid;
      IF v_line_id IS NOT NULL THEN
        IF v_line_id = ANY (v_keep_ids) THEN
          RAISE EXCEPTION 'The same line item appears twice';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM public.order_line_items
          WHERE id = v_line_id AND order_id = p_order_id
        ) THEN
          RAISE EXCEPTION 'Line item does not belong to this order';
        END IF;
        v_keep_ids := v_keep_ids || v_line_id;
      ELSE
        v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
        IF v_product_id IS NULL THEN
          RAISE EXCEPTION 'New items need a product';
        END IF;
        -- Same convention as the client product list: an account with allowed-
        -- product rows is restricted to them; otherwise it can order its own
        -- active products.
        IF v_restricted THEN
          IF NOT EXISTS (
            SELECT 1
            FROM public.client_allowed_products cap
            JOIN public.products p ON p.id = cap.product_id
            WHERE cap.account_id = v_order.account_id
              AND cap.product_id = v_product_id
              AND p.is_active
          ) THEN
            RAISE EXCEPTION 'That product is not available for this account';
          END IF;
        ELSIF NOT EXISTS (
          SELECT 1 FROM public.products p
          WHERE p.id = v_product_id
            AND p.account_id = v_order.account_id
            AND p.is_active
        ) THEN
          RAISE EXCEPTION 'That product is not available for this account';
        END IF;
      END IF;
    END LOOP;

    -- Pass 2: remove lines that were dropped. Packed (picked) units block it.
    FOR v_removed IN
      SELECT oli.id, p.product_name, COALESCE(sp.units_picked, 0) AS units_picked
      FROM public.order_line_items oli
      JOIN public.products p ON p.id = oli.product_id
      LEFT JOIN public.ship_picks sp ON sp.order_line_item_id = oli.id
      WHERE oli.order_id = p_order_id
        AND NOT (oli.id = ANY (v_keep_ids))
    LOOP
      IF v_removed.units_picked > 0 THEN
        RAISE EXCEPTION '% is already packed and can''t be removed — contact Home Island', v_removed.product_name;
      END IF;
      DELETE FROM public.order_line_items WHERE id = v_removed.id;
    END LOOP;

    -- Pass 3: update kept lines, insert new ones.
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_changes->'line_items') LOOP
      v_qty := (v_item->>'quantity_units')::integer;
      v_line_id := NULLIF(v_item->>'line_item_id', '')::uuid;

      IF v_line_id IS NOT NULL THEN
        SELECT COALESCE(sp.units_picked, 0) INTO v_picked
        FROM public.order_line_items oli
        LEFT JOIN public.ship_picks sp ON sp.order_line_item_id = oli.id
        WHERE oli.id = v_line_id;

        IF v_qty < COALESCE(v_picked, 0) THEN
          RAISE EXCEPTION '% units of an item are already packed — quantity can''t go below that. Contact Home Island.', v_picked;
        END IF;

        UPDATE public.order_line_items
        SET quantity_units = v_qty
        WHERE id = v_line_id
          AND quantity_units IS DISTINCT FROM v_qty;
      ELSE
        v_product_id := (v_item->>'product_id')::uuid;

        SELECT pl.unit_price INTO v_price
        FROM public.price_list pl
        WHERE pl.product_id = v_product_id
          AND pl.effective_date <= CURRENT_DATE
        ORDER BY pl.effective_date DESC
        LIMIT 1;

        INSERT INTO public.order_line_items
          (order_id, product_id, quantity_units, unit_price_locked, shipment_id)
        VALUES
          (p_order_id, v_product_id, v_qty, COALESCE(v_price, 0), v_primary_shipment_id);
      END IF;
    END LOOP;
  END IF;

  -- ---- Order fields --------------------------------------------------------
  IF p_changes ? 'requested_ship_date' THEN
    -- JSON null (or empty) = "soonest possible".
    UPDATE public.orders
    SET requested_ship_date = NULLIF(p_changes->>'requested_ship_date', '')::date
    WHERE id = p_order_id;
  END IF;

  IF p_changes ? 'client_po' THEN
    UPDATE public.orders
    SET client_po = NULLIF(btrim(COALESCE(p_changes->>'client_po', '')), '')
    WHERE id = p_order_id;
  END IF;

  IF p_changes ? 'client_notes' THEN
    UPDATE public.orders
    SET client_notes = NULLIF(btrim(COALESCE(p_changes->>'client_notes', '')), '')
    WHERE id = p_order_id;
  END IF;

  IF p_changes ? 'delivery_method' AND p_changes->>'delivery_method' IS NOT NULL THEN
    v_method := (p_changes->>'delivery_method')::public.delivery_method;
    IF v_method NOT IN ('PICKUP'::public.delivery_method, 'DELIVERY'::public.delivery_method) THEN
      RAISE EXCEPTION 'Delivery method must be pickup or delivered';
    END IF;

    -- Clients only choose pickup vs delivered. Courier vs our own delivery is
    -- an internal call, so "delivered" never overwrites an existing COURIER.
    IF v_method = 'DELIVERY'::public.delivery_method
       AND v_order.delivery_method = 'COURIER'::public.delivery_method THEN
      v_method := v_order.delivery_method;
    END IF;

    UPDATE public.orders
    SET delivery_method = v_method
    WHERE id = p_order_id
      AND delivery_method IS DISTINCT FROM v_method;

    IF v_primary_shipment_id IS NOT NULL
       AND ((v_method = 'PICKUP'::public.delivery_method)
            <> (v_primary_method = 'PICKUP'::public.delivery_method)) THEN
      UPDATE public.order_shipments
      SET delivery_method = v_method
      WHERE id = v_primary_shipment_id;
    END IF;
  END IF;

  UPDATE public.orders SET updated_at = now() WHERE id = p_order_id;
END;
$$;

-- Client entry point. SUBMITTED/DRAFT → applied now; CONFIRMED/IN_PRODUCTION/
-- READY → stored as a PENDING change request (replacing any earlier pending
-- one). Returns { mode: 'APPLIED' | 'REQUESTED', request_id }.
CREATE OR REPLACE FUNCTION public.client_edit_order(
  p_order_id uuid,
  p_changes jsonb,
  p_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_is_staff boolean;
  v_changes jsonb;
  v_snapshot jsonb;
  v_message text := NULLIF(btrim(COALESCE(p_message, '')), '');
  v_request_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  -- Staff are allowed so admin "preview as client" works end to end.
  v_is_staff := public.has_role(auth.uid(), 'ADMIN'::public.app_role)
             OR public.has_role(auth.uid(), 'OPS'::public.app_role);
  IF NOT v_is_staff AND NOT EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = v_order.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO v_changes
  FROM jsonb_each(COALESCE(p_changes, '{}'::jsonb))
  WHERE key IN ('line_items', 'requested_ship_date', 'delivery_method', 'client_po', 'client_notes');

  IF v_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'No changes supplied';
  END IF;

  v_snapshot := public._order_change_snapshot(p_order_id);

  IF v_order.status IN ('DRAFT'::public.order_status, 'SUBMITTED'::public.order_status) THEN
    PERFORM public._apply_order_changes(p_order_id, v_changes);

    INSERT INTO public.order_change_requests
      (order_id, account_id, status, order_status_at_request, proposed, snapshot,
       client_message, requested_by, resolved_at)
    VALUES
      (p_order_id, v_order.account_id, 'AUTO_APPLIED', v_order.status, v_changes, v_snapshot,
       v_message, auth.uid(), now())
    RETURNING id INTO v_request_id;

    RETURN jsonb_build_object('mode', 'APPLIED', 'request_id', v_request_id);
  END IF;

  IF v_order.status NOT IN (
    'CONFIRMED'::public.order_status,
    'IN_PRODUCTION'::public.order_status,
    'READY'::public.order_status
  ) THEN
    RAISE EXCEPTION 'This order can no longer be changed online — contact Home Island';
  END IF;

  -- Dry run: apply inside a subtransaction and roll it back, so an invalid
  -- request is rejected now instead of failing later at staff review.
  BEGIN
    PERFORM public._apply_order_changes(p_order_id, v_changes);
    RAISE EXCEPTION '__order_change_dry_run_ok__';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> '__order_change_dry_run_ok__' THEN
      RAISE;
    END IF;
  END;

  UPDATE public.order_change_requests
  SET proposed = v_changes,
      snapshot = v_snapshot,
      client_message = v_message,
      order_status_at_request = v_order.status,
      requested_by = auth.uid(),
      requested_at = now()
  WHERE order_id = p_order_id
    AND status = 'PENDING'
  RETURNING id INTO v_request_id;

  IF v_request_id IS NULL THEN
    INSERT INTO public.order_change_requests
      (order_id, account_id, status, order_status_at_request, proposed, snapshot,
       client_message, requested_by)
    VALUES
      (p_order_id, v_order.account_id, 'PENDING', v_order.status, v_changes, v_snapshot,
       v_message, auth.uid())
    RETURNING id INTO v_request_id;
  END IF;

  RETURN jsonb_build_object('mode', 'REQUESTED', 'request_id', v_request_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.client_withdraw_order_change_request(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.order_change_requests;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.order_change_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.status <> 'PENDING' THEN
    RETURN false;
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'ADMIN'::public.app_role)
    OR public.has_role(auth.uid(), 'OPS'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = v_req.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.order_change_requests
  SET status = 'WITHDRAWN', resolved_by = auth.uid(), resolved_at = now()
  WHERE id = p_request_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_order_change_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text DEFAULT NULL
)
RETURNS public.order_change_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.order_change_requests;
  v_order_status public.order_status;
BEGIN
  PERFORM public._assert_internal_staff();

  SELECT * INTO v_req FROM public.order_change_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change request not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_req.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Change request is already %', lower(v_req.status);
  END IF;

  IF p_approve THEN
    SELECT status INTO v_order_status FROM public.orders WHERE id = v_req.order_id FOR UPDATE;
    IF v_order_status IN ('SHIPPED'::public.order_status, 'CANCELLED'::public.order_status) THEN
      RAISE EXCEPTION 'Order is % — change can''t be applied', lower(v_order_status::text);
    END IF;
    PERFORM public._apply_order_changes(v_req.order_id, v_req.proposed);
  END IF;

  UPDATE public.order_change_requests
  SET status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'DECLINED' END,
      resolved_by = auth.uid(),
      resolved_at = now(),
      resolution_note = NULLIF(btrim(COALESCE(p_note, '')), '')
  WHERE id = p_request_id
  RETURNING * INTO v_req;

  RETURN v_req;
END;
$$;

REVOKE ALL ON FUNCTION public._order_change_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._apply_order_changes(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_edit_order(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.client_withdraw_order_change_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_order_change_request(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_edit_order(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_withdraw_order_change_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_order_change_request(uuid, boolean, text) TO authenticated;

-- ============================================================
-- 3. client_product_notes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.client_product_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  roast_group text NOT NULL REFERENCES public.roast_groups(roast_group) ON UPDATE CASCADE ON DELETE CASCADE,
  note_text text NOT NULL CHECK (length(btrim(note_text)) > 0 AND length(note_text) <= 4000),
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  -- Snapshotted at insert so clients can see who wrote a note without read
  -- access to profiles / user_roles.
  author_name text,
  author_is_staff boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_product_notes_account_rg
  ON public.client_product_notes(account_id, roast_group, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_client_product_note_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.created_by := auth.uid();
  SELECT p.name INTO NEW.author_name FROM public.profiles p WHERE p.user_id = auth.uid();
  NEW.author_is_staff := public.has_role(auth.uid(), 'ADMIN'::public.app_role)
                      OR public.has_role(auth.uid(), 'OPS'::public.app_role);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_product_note_author ON public.client_product_notes;
CREATE TRIGGER trg_client_product_note_author
  BEFORE INSERT ON public.client_product_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_client_product_note_author();

DROP TRIGGER IF EXISTS update_client_product_notes_updated_at ON public.client_product_notes;
CREATE TRIGGER update_client_product_notes_updated_at
  BEFORE UPDATE ON public.client_product_notes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.client_product_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can manage client product notes" ON public.client_product_notes;
CREATE POLICY "Staff can manage client product notes"
  ON public.client_product_notes
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'ADMIN'::public.app_role)
    OR public.has_role(auth.uid(), 'OPS'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'ADMIN'::public.app_role)
    OR public.has_role(auth.uid(), 'OPS'::public.app_role)
  );

DROP POLICY IF EXISTS "Account users can view own product notes" ON public.client_product_notes;
CREATE POLICY "Account users can view own product notes"
  ON public.client_product_notes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = client_product_notes.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  ));

DROP POLICY IF EXISTS "Account users can add product notes" ON public.client_product_notes;
CREATE POLICY "Account users can add product notes"
  ON public.client_product_notes
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = client_product_notes.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  ));

DROP POLICY IF EXISTS "Account users can edit own product notes" ON public.client_product_notes;
CREATE POLICY "Account users can edit own product notes"
  ON public.client_product_notes
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = client_product_notes.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );

DROP POLICY IF EXISTS "Account users can delete own product notes" ON public.client_product_notes;
CREATE POLICY "Account users can delete own product notes"
  ON public.client_product_notes
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

REVOKE ALL ON public.client_product_notes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_product_notes TO authenticated;

-- ============================================================
-- 4. Client-facing green coffee detail
-- ============================================================
-- One lot, descriptive fields only. Contract fields win; purchase-line fields
-- fill gaps for lots bought without a contract.
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
    'running_low', (l.status = 'RECEIVED' AND l.kg_on_hand > 0 AND l.kg_on_hand <= 10),
    'depleted', (l.status = 'RECEIVED' AND l.kg_on_hand <= 0)
  )
  FROM public.green_lots l
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
             SELECT jsonb_agg(jsonb_build_object(
                      'current', public._client_green_lot_json(gl.lot_id),
                      'next', CASE WHEN gl.successor_lot_id IS NOT NULL
                                   THEN public._client_green_lot_json(gl.successor_lot_id)
                              END
                    ) ORDER BY gl.created_at)
             FROM public.green_lot_roast_group_links gl
             WHERE gl.roast_group = comps.rg
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

REVOKE ALL ON FUNCTION public._client_green_lot_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_client_green_detail(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_green_detail(uuid, text) TO authenticated;
