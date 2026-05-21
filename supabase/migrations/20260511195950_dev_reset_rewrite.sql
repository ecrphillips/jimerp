-- Rewrite of dev_test_reset, dev_reset_test_day, dev_reset_master_data
-- against the current schema (May 2026).
--
-- - dev_test_reset: full transactional rollback. Deletes ALL orders +
--   transactional data (orders/production/inventory/quotes/offers/
--   prospects/CRM transactional/comms/locked prices). Preserves master
--   data (clients/products/roast_groups/green coffee/pricing/packaging/
--   accounts/coroast/etc).
-- - dev_reset_test_day: thin wrapper that calls dev_test_reset for UI
--   compatibility.
-- - dev_reset_master_data: nuclear. dev_test_reset + master data
--   (clients/products/roast_groups/green/pricing/packaging/coroast/
--   accounts). Preserves: auth users, profiles, user_roles, app_settings,
--   sourcing_sequences (PO/lot counter monotonicity), schema/enums.
--
-- All three are SECURITY DEFINER, gated on ADMIN role, single plpgsql
-- function = single implicit transaction = all-or-nothing.

-- Return type of dev_test_reset changes from void -> jsonb, so drop first.
DROP FUNCTION IF EXISTS public.dev_test_reset();
DROP FUNCTION IF EXISTS public.dev_reset_test_day();
DROP FUNCTION IF EXISTS public.dev_reset_master_data();

-- ============================================================
-- RPC 1: dev_test_reset  (transactional rollback)
-- ============================================================
CREATE FUNCTION public.dev_test_reset()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts jsonb := '{}'::jsonb;
  v_rows   integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'ADMIN'::app_role) THEN
    RAISE EXCEPTION 'Access denied: ADMIN role required';
  END IF;

  -- ========== ORDER GRAPH (children first) ==========
  DELETE FROM public.ship_picks;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ship_picks', v_rows);

  DELETE FROM public.inventory_transactions;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('inventory_transactions', v_rows);

  DELETE FROM public.order_notifications;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('order_notifications', v_rows);

  DELETE FROM public.order_date_audit_log;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('order_date_audit_log', v_rows);

  DELETE FROM public.external_demand;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('external_demand', v_rows);

  DELETE FROM public.order_line_items;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('order_line_items', v_rows);

  DELETE FROM public.orders;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('orders', v_rows);

  -- ========== PRODUCTION GRAPH ==========
  DELETE FROM public.andon_picks;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('andon_picks', v_rows);

  DELETE FROM public.roast_exception_events;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('roast_exception_events', v_rows);

  DELETE FROM public.production_checkmarks;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('production_checkmarks', v_rows);

  DELETE FROM public.production_plan_items;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('production_plan_items', v_rows);

  DELETE FROM public.packing_runs;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('packing_runs', v_rows);

  DELETE FROM public.wip_ledger;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('wip_ledger', v_rows);

  DELETE FROM public.wip_adjustments;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('wip_adjustments', v_rows);

  DELETE FROM public.fg_inventory_log;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('fg_inventory_log', v_rows);

  DELETE FROM public.roasted_batches;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('roasted_batches', v_rows);

  -- ========== INVENTORY ZERO-OUT (preserve rows) ==========
  UPDATE public.fg_inventory SET units_on_hand = 0, updated_at = now() WHERE units_on_hand <> 0;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('fg_inventory_zeroed', v_rows);

  UPDATE public.roast_group_inventory_levels
    SET wip_kg = 0, fg_kg = 0, updated_at = now()
    WHERE wip_kg <> 0 OR fg_kg <> 0;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('roast_group_inventory_levels_zeroed', v_rows);

  -- ========== QUOTES / OFFERS / STANDING OFFERS ==========
  DELETE FROM public.quote_line_items;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('quote_line_items', v_rows);

  DELETE FROM public.quotes;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('quotes', v_rows);

  DELETE FROM public.offer_workspace_lines;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('offer_workspace_lines', v_rows);

  DELETE FROM public.offer_workspace_sessions;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('offer_workspace_sessions', v_rows);

  DELETE FROM public.standing_offer_lines;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('standing_offer_lines', v_rows);

  DELETE FROM public.standing_offer_sessions;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('standing_offer_sessions', v_rows);

  -- ========== PROSPECTS + CRM TRANSACTIONAL ==========
  DELETE FROM public.prospect_notes;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('prospect_notes', v_rows);

  DELETE FROM public.prospects;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('prospects', v_rows);

  DELETE FROM public.client_notes;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('client_notes', v_rows);

  -- ========== COMMS / EMAIL INFRA ==========
  DELETE FROM public.email_send_log;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('email_send_log', v_rows);

  DELETE FROM public.email_send_state;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('email_send_state', v_rows);

  DELETE FROM public.email_unsubscribe_tokens;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('email_unsubscribe_tokens', v_rows);

  DELETE FROM public.suppressed_emails;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('suppressed_emails', v_rows);

  DELETE FROM public.feedback_submissions;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('feedback_submissions', v_rows);

  -- ========== LOCKED PRICES (tied to orders) ==========
  DELETE FROM public.locked_prices;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('locked_prices', v_rows);

  RETURN v_counts;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dev_test_reset() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dev_test_reset() TO authenticated;

-- ============================================================
-- RPC 2: dev_reset_test_day  (alias of dev_test_reset)
-- ============================================================
CREATE FUNCTION public.dev_reset_test_day()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ADMIN check is also performed inside dev_test_reset, but verifying
  -- here gives a clearer error and avoids the inner call when unauthorized.
  IF NOT public.has_role(auth.uid(), 'ADMIN'::app_role) THEN
    RAISE EXCEPTION 'Access denied: ADMIN role required';
  END IF;

  RETURN public.dev_test_reset();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dev_reset_test_day() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dev_reset_test_day() TO authenticated;

-- ============================================================
-- RPC 3: dev_reset_master_data  (nuclear)
-- ============================================================
CREATE FUNCTION public.dev_reset_master_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts jsonb;
  v_rows   integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'ADMIN'::app_role) THEN
    RAISE EXCEPTION 'Access denied: ADMIN role required';
  END IF;

  -- Phase 1: clear all transactional data via dev_test_reset.
  v_counts := public.dev_test_reset();

  -- Phase 2: clear master data graph.

  -- Pricing config (depends on products/clients)
  DELETE FROM public.price_list;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('price_list', v_rows);

  DELETE FROM public.pricing_rules;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('pricing_rules', v_rows);

  DELETE FROM public.pricing_rule_profiles;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('pricing_rule_profiles', v_rows);

  DELETE FROM public.pricing_tiers;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('pricing_tiers', v_rows);

  DELETE FROM public.packaging_costs;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('packaging_costs', v_rows);

  DELETE FROM public.packaging_types;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('packaging_types', v_rows);

  -- Board / allowed products
  DELETE FROM public.source_board_products;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('source_board_products', v_rows);

  DELETE FROM public.client_allowed_products;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('client_allowed_products', v_rows);

  -- Coroast (full wipe at nuclear tier)
  DELETE FROM public.coroast_storage_allocations;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_storage_allocations', v_rows);

  DELETE FROM public.coroast_waiver_log;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_waiver_log', v_rows);

  DELETE FROM public.coroast_hour_ledger;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_hour_ledger', v_rows);

  DELETE FROM public.coroast_billing_extras;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_billing_extras', v_rows);

  DELETE FROM public.coroast_bookings;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_bookings', v_rows);

  DELETE FROM public.coroast_billing_periods;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_billing_periods', v_rows);

  DELETE FROM public.coroast_recurring_blocks;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_recurring_blocks', v_rows);

  DELETE FROM public.coroast_member_notes;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_member_notes', v_rows);

  DELETE FROM public.coroast_member_checklist;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_member_checklist', v_rows);

  DELETE FROM public.coroast_invoices;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_invoices', v_rows);

  DELETE FROM public.coroast_unit_economics_scenarios;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_unit_economics_scenarios', v_rows);

  DELETE FROM public.coroast_availability_windows;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_availability_windows', v_rows);

  DELETE FROM public.coroast_loring_blocks;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_loring_blocks', v_rows);

  DELETE FROM public.coroast_prospect_submissions;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_prospect_submissions', v_rows);

  DELETE FROM public.coroast_prospect_invitations;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_prospect_invitations', v_rows);

  DELETE FROM public.coroast_members;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('coroast_members', v_rows);

  -- Green coffee graph
  DELETE FROM public.green_lot_consumption_log;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_lot_consumption_log', v_rows);

  DELETE FROM public.green_lot_roast_group_links;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_lot_roast_group_links', v_rows);

  DELETE FROM public.green_lot_notes;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_lot_notes', v_rows);

  DELETE FROM public.green_sample_roast_profile_links;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_sample_roast_profile_links', v_rows);

  DELETE FROM public.green_sample_notes;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_sample_notes', v_rows);

  DELETE FROM public.green_inventory_snapshots;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_inventory_snapshots', v_rows);

  DELETE FROM public.green_release_lines;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_release_lines', v_rows);

  DELETE FROM public.green_releases;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_releases', v_rows);

  DELETE FROM public.green_purchase_lines;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_purchase_lines', v_rows);

  DELETE FROM public.green_purchases;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_purchases', v_rows);

  DELETE FROM public.green_contract_notes;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_contract_notes', v_rows);

  DELETE FROM public.green_contracts;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_contracts', v_rows);

  DELETE FROM public.green_lots;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_lots', v_rows);

  DELETE FROM public.green_coffee_lots;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_coffee_lots', v_rows);

  DELETE FROM public.green_samples;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_samples', v_rows);

  DELETE FROM public.green_vendor_notes;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_vendor_notes', v_rows);

  DELETE FROM public.green_vendors;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('green_vendors', v_rows);

  -- Product graph
  DELETE FROM public.roast_group_notes;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('roast_group_notes', v_rows);

  DELETE FROM public.roast_group_components;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('roast_group_components', v_rows);

  DELETE FROM public.roast_group_inventory_levels;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('roast_group_inventory_levels', v_rows);

  DELETE FROM public.fg_inventory;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('fg_inventory', v_rows);

  DELETE FROM public.products;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('products', v_rows);

  DELETE FROM public.roast_groups;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('roast_groups', v_rows);

  -- Client/account graph
  DELETE FROM public.client_locations;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('client_locations', v_rows);

  DELETE FROM public.clients;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('clients', v_rows);

  DELETE FROM public.account_user_locations;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('account_user_locations', v_rows);

  DELETE FROM public.account_users;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('account_users', v_rows);

  DELETE FROM public.account_locations;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('account_locations', v_rows);

  DELETE FROM public.accounts;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_counts := v_counts || jsonb_build_object('accounts', v_rows);

  -- sourcing_sequences intentionally preserved (PO/lot counter monotonicity).
  -- app_settings, profiles, user_roles, auth.users preserved.

  RETURN v_counts || jsonb_build_object('status', 'success');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dev_reset_master_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dev_reset_master_data() TO authenticated;
