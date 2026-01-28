-- ============================================================
-- COMPREHENSIVE SECURITY HARDENING MIGRATION
-- Ensures all tables: deny anonymous, force RLS, revoke public
-- ============================================================

-- ========== REVOKE PUBLIC/ANON ACCESS FROM ALL SENSITIVE TABLES ==========

-- Production/Inventory tables
REVOKE ALL ON public.andon_picks FROM anon, public;
REVOKE ALL ON public.app_settings FROM anon, public;
REVOKE ALL ON public.external_demand FROM anon, public;
REVOKE ALL ON public.fg_inventory FROM anon, public;
REVOKE ALL ON public.fg_inventory_log FROM anon, public;
REVOKE ALL ON public.green_coffee_lots FROM anon, public;
REVOKE ALL ON public.inventory_transactions FROM anon, public;
REVOKE ALL ON public.order_date_audit_log FROM anon, public;
REVOKE ALL ON public.packing_runs FROM anon, public;
REVOKE ALL ON public.production_checkmarks FROM anon, public;
REVOKE ALL ON public.production_plan_items FROM anon, public;
REVOKE ALL ON public.roast_exception_events FROM anon, public;
REVOKE ALL ON public.roast_group_components FROM anon, public;
REVOKE ALL ON public.roast_group_inventory_levels FROM anon, public;
REVOKE ALL ON public.roast_groups FROM anon, public;
REVOKE ALL ON public.roasted_batches FROM anon, public;
REVOKE ALL ON public.ship_picks FROM anon, public;
REVOKE ALL ON public.source_board_products FROM anon, public;
REVOKE ALL ON public.wip_adjustments FROM anon, public;
REVOKE ALL ON public.wip_ledger FROM anon, public;
REVOKE ALL ON public.client_locations FROM anon, public;

-- Ensure authenticated role has access
GRANT ALL ON public.andon_picks TO authenticated;
GRANT ALL ON public.app_settings TO authenticated;
GRANT ALL ON public.external_demand TO authenticated;
GRANT ALL ON public.fg_inventory TO authenticated;
GRANT ALL ON public.fg_inventory_log TO authenticated;
GRANT ALL ON public.green_coffee_lots TO authenticated;
GRANT ALL ON public.inventory_transactions TO authenticated;
GRANT ALL ON public.order_date_audit_log TO authenticated;
GRANT ALL ON public.packing_runs TO authenticated;
GRANT ALL ON public.production_checkmarks TO authenticated;
GRANT ALL ON public.production_plan_items TO authenticated;
GRANT ALL ON public.roast_exception_events TO authenticated;
GRANT ALL ON public.roast_group_components TO authenticated;
GRANT ALL ON public.roast_group_inventory_levels TO authenticated;
GRANT ALL ON public.roast_groups TO authenticated;
GRANT ALL ON public.roasted_batches TO authenticated;
GRANT ALL ON public.ship_picks TO authenticated;
GRANT ALL ON public.source_board_products TO authenticated;
GRANT ALL ON public.wip_adjustments TO authenticated;
GRANT ALL ON public.wip_ledger TO authenticated;
GRANT ALL ON public.client_locations TO authenticated;

-- ========== FORCE ROW LEVEL SECURITY ON ALL TABLES ==========

ALTER TABLE public.andon_picks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.external_demand FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fg_inventory FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fg_inventory_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.green_coffee_lots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_date_audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.packing_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_checkmarks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_plan_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.roast_exception_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.roast_group_components FORCE ROW LEVEL SECURITY;
ALTER TABLE public.roast_group_inventory_levels FORCE ROW LEVEL SECURITY;
ALTER TABLE public.roast_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.roasted_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ship_picks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.source_board_products FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wip_adjustments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wip_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE public.client_locations FORCE ROW LEVEL SECURITY;

-- ========== ADD EXPLICIT DENY ANONYMOUS POLICIES ==========

-- andon_picks
DROP POLICY IF EXISTS "Deny anonymous access to andon_picks" ON public.andon_picks;
CREATE POLICY "Deny anonymous access to andon_picks"
ON public.andon_picks FOR ALL TO anon
USING (false) WITH CHECK (false);

-- app_settings
DROP POLICY IF EXISTS "Deny anonymous access to app_settings" ON public.app_settings;
CREATE POLICY "Deny anonymous access to app_settings"
ON public.app_settings FOR ALL TO anon
USING (false) WITH CHECK (false);

-- external_demand
DROP POLICY IF EXISTS "Deny anonymous access to external_demand" ON public.external_demand;
CREATE POLICY "Deny anonymous access to external_demand"
ON public.external_demand FOR ALL TO anon
USING (false) WITH CHECK (false);

-- fg_inventory
DROP POLICY IF EXISTS "Deny anonymous access to fg_inventory" ON public.fg_inventory;
CREATE POLICY "Deny anonymous access to fg_inventory"
ON public.fg_inventory FOR ALL TO anon
USING (false) WITH CHECK (false);

-- fg_inventory_log
DROP POLICY IF EXISTS "Deny anonymous access to fg_inventory_log" ON public.fg_inventory_log;
CREATE POLICY "Deny anonymous access to fg_inventory_log"
ON public.fg_inventory_log FOR ALL TO anon
USING (false) WITH CHECK (false);

-- green_coffee_lots
DROP POLICY IF EXISTS "Deny anonymous access to green_coffee_lots" ON public.green_coffee_lots;
CREATE POLICY "Deny anonymous access to green_coffee_lots"
ON public.green_coffee_lots FOR ALL TO anon
USING (false) WITH CHECK (false);

-- inventory_transactions
DROP POLICY IF EXISTS "Deny anonymous access to inventory_transactions" ON public.inventory_transactions;
CREATE POLICY "Deny anonymous access to inventory_transactions"
ON public.inventory_transactions FOR ALL TO anon
USING (false) WITH CHECK (false);

-- order_date_audit_log
DROP POLICY IF EXISTS "Deny anonymous access to order_date_audit_log" ON public.order_date_audit_log;
CREATE POLICY "Deny anonymous access to order_date_audit_log"
ON public.order_date_audit_log FOR ALL TO anon
USING (false) WITH CHECK (false);

-- packing_runs
DROP POLICY IF EXISTS "Deny anonymous access to packing_runs" ON public.packing_runs;
CREATE POLICY "Deny anonymous access to packing_runs"
ON public.packing_runs FOR ALL TO anon
USING (false) WITH CHECK (false);

-- production_checkmarks
DROP POLICY IF EXISTS "Deny anonymous access to production_checkmarks" ON public.production_checkmarks;
CREATE POLICY "Deny anonymous access to production_checkmarks"
ON public.production_checkmarks FOR ALL TO anon
USING (false) WITH CHECK (false);

-- production_plan_items
DROP POLICY IF EXISTS "Deny anonymous access to production_plan_items" ON public.production_plan_items;
CREATE POLICY "Deny anonymous access to production_plan_items"
ON public.production_plan_items FOR ALL TO anon
USING (false) WITH CHECK (false);

-- roast_exception_events
DROP POLICY IF EXISTS "Deny anonymous access to roast_exception_events" ON public.roast_exception_events;
CREATE POLICY "Deny anonymous access to roast_exception_events"
ON public.roast_exception_events FOR ALL TO anon
USING (false) WITH CHECK (false);

-- roast_group_components
DROP POLICY IF EXISTS "Deny anonymous access to roast_group_components" ON public.roast_group_components;
CREATE POLICY "Deny anonymous access to roast_group_components"
ON public.roast_group_components FOR ALL TO anon
USING (false) WITH CHECK (false);

-- roast_group_inventory_levels
DROP POLICY IF EXISTS "Deny anonymous access to roast_group_inventory_levels" ON public.roast_group_inventory_levels;
CREATE POLICY "Deny anonymous access to roast_group_inventory_levels"
ON public.roast_group_inventory_levels FOR ALL TO anon
USING (false) WITH CHECK (false);

-- roast_groups
DROP POLICY IF EXISTS "Deny anonymous access to roast_groups" ON public.roast_groups;
CREATE POLICY "Deny anonymous access to roast_groups"
ON public.roast_groups FOR ALL TO anon
USING (false) WITH CHECK (false);

-- roasted_batches
DROP POLICY IF EXISTS "Deny anonymous access to roasted_batches" ON public.roasted_batches;
CREATE POLICY "Deny anonymous access to roasted_batches"
ON public.roasted_batches FOR ALL TO anon
USING (false) WITH CHECK (false);

-- ship_picks
DROP POLICY IF EXISTS "Deny anonymous access to ship_picks" ON public.ship_picks;
CREATE POLICY "Deny anonymous access to ship_picks"
ON public.ship_picks FOR ALL TO anon
USING (false) WITH CHECK (false);

-- source_board_products
DROP POLICY IF EXISTS "Deny anonymous access to source_board_products" ON public.source_board_products;
CREATE POLICY "Deny anonymous access to source_board_products"
ON public.source_board_products FOR ALL TO anon
USING (false) WITH CHECK (false);

-- wip_adjustments
DROP POLICY IF EXISTS "Deny anonymous access to wip_adjustments" ON public.wip_adjustments;
CREATE POLICY "Deny anonymous access to wip_adjustments"
ON public.wip_adjustments FOR ALL TO anon
USING (false) WITH CHECK (false);

-- wip_ledger
DROP POLICY IF EXISTS "Deny anonymous access to wip_ledger" ON public.wip_ledger;
CREATE POLICY "Deny anonymous access to wip_ledger"
ON public.wip_ledger FOR ALL TO anon
USING (false) WITH CHECK (false);

-- client_locations
DROP POLICY IF EXISTS "Deny anonymous access to client_locations" ON public.client_locations;
CREATE POLICY "Deny anonymous access to client_locations"
ON public.client_locations FOR ALL TO anon
USING (false) WITH CHECK (false);