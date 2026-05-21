-- =============================================================================
-- fix(inventory): add positive RLS policies to all four inventory tables
-- =============================================================================
-- Tables: inventory_transactions, wip_ledger, fg_inventory, fg_inventory_log
--
-- Starting state (per S-series audit):
--   * All four tables have FORCE ROW LEVEL SECURITY enabled and
--     GRANT ALL ... TO authenticated.
--   * No positive policies remain on these tables in the live DB, so authenticated
--     reads/writes are silently denied by RLS regardless of role.
--
-- Target state:
--   * ADMIN  : full FOR ALL                       (has_role check)
--   * OPS    : full FOR ALL                       (has_role check — matches existing
--               codebase convention for production-side tables; the codebase has no
--               OPS ↔ account_users mapping to scope OPS by client)
--   * CLIENT : SELECT only, scoped to rows whose product (and, where applicable,
--               order) belongs to an account the user is an active member of.
--
-- Anonymous role: already denied by the existing "Deny anonymous access to ..."
-- policies created in 20260128221531. Not recreated here.
--
-- Idempotent: drops any legacy policy by every name we have created in prior
-- migrations before recreating.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- inventory_transactions
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin/Ops can manage inventory transactions"
  ON public.inventory_transactions;
DROP POLICY IF EXISTS "Admin full access to inventory_transactions"
  ON public.inventory_transactions;
DROP POLICY IF EXISTS "Ops full access to inventory_transactions"
  ON public.inventory_transactions;
DROP POLICY IF EXISTS "Clients can view own inventory_transactions"
  ON public.inventory_transactions;

CREATE POLICY "Admin full access to inventory_transactions"
  ON public.inventory_transactions
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::public.app_role));

CREATE POLICY "Ops full access to inventory_transactions"
  ON public.inventory_transactions
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'OPS'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'OPS'::public.app_role));

-- CLIENT: read-only, scoped via order_id → orders.account_id OR
-- product_id → products.account_id. A row matches if EITHER fk belongs to one of
-- the user's active account memberships.
CREATE POLICY "Clients can view own inventory_transactions"
  ON public.inventory_transactions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    (
      inventory_transactions.order_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.orders o
        JOIN public.account_users au ON au.account_id = o.account_id
        WHERE o.id = inventory_transactions.order_id
          AND au.user_id = auth.uid()
          AND au.is_active = true
      )
    )
    OR (
      inventory_transactions.product_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.products p
        JOIN public.account_users au ON au.account_id = p.account_id
        WHERE p.id = inventory_transactions.product_id
          AND au.user_id = auth.uid()
          AND au.is_active = true
      )
    )
  );

-- -----------------------------------------------------------------------------
-- wip_ledger
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin/Ops can manage wip ledger"
  ON public.wip_ledger;
DROP POLICY IF EXISTS "Admin full access to wip_ledger"
  ON public.wip_ledger;
DROP POLICY IF EXISTS "Ops full access to wip_ledger"
  ON public.wip_ledger;
DROP POLICY IF EXISTS "Clients can view own wip_ledger"
  ON public.wip_ledger;

CREATE POLICY "Admin full access to wip_ledger"
  ON public.wip_ledger
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::public.app_role));

CREATE POLICY "Ops full access to wip_ledger"
  ON public.wip_ledger
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'OPS'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'OPS'::public.app_role));

-- CLIENT: read-only, scoped via related_product_id → products.account_id.
-- Rows with NULL related_product_id are production-internal and never exposed.
CREATE POLICY "Clients can view own wip_ledger"
  ON public.wip_ledger
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    wip_ledger.related_product_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.products p
      JOIN public.account_users au ON au.account_id = p.account_id
      WHERE p.id = wip_ledger.related_product_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );

-- -----------------------------------------------------------------------------
-- fg_inventory
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin/Ops can manage fg inventory"
  ON public.fg_inventory;
DROP POLICY IF EXISTS "Admin full access to fg_inventory"
  ON public.fg_inventory;
DROP POLICY IF EXISTS "Ops full access to fg_inventory"
  ON public.fg_inventory;
DROP POLICY IF EXISTS "Clients can view own fg_inventory"
  ON public.fg_inventory;

CREATE POLICY "Admin full access to fg_inventory"
  ON public.fg_inventory
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::public.app_role));

CREATE POLICY "Ops full access to fg_inventory"
  ON public.fg_inventory
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'OPS'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'OPS'::public.app_role));

CREATE POLICY "Clients can view own fg_inventory"
  ON public.fg_inventory
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.products p
      JOIN public.account_users au ON au.account_id = p.account_id
      WHERE p.id = fg_inventory.product_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );

-- -----------------------------------------------------------------------------
-- fg_inventory_log
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin/Ops can manage fg inventory log"
  ON public.fg_inventory_log;
DROP POLICY IF EXISTS "Admin full access to fg_inventory_log"
  ON public.fg_inventory_log;
DROP POLICY IF EXISTS "Ops full access to fg_inventory_log"
  ON public.fg_inventory_log;
DROP POLICY IF EXISTS "Clients can view own fg_inventory_log"
  ON public.fg_inventory_log;

CREATE POLICY "Admin full access to fg_inventory_log"
  ON public.fg_inventory_log
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::public.app_role));

CREATE POLICY "Ops full access to fg_inventory_log"
  ON public.fg_inventory_log
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'OPS'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'OPS'::public.app_role));

CREATE POLICY "Clients can view own fg_inventory_log"
  ON public.fg_inventory_log
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.products p
      JOIN public.account_users au ON au.account_id = p.account_id
      WHERE p.id = fg_inventory_log.product_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );
