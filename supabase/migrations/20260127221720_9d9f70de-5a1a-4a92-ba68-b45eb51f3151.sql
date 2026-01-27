-- DEV ONLY: Complete master data reset
-- Clears all clients, products, roast groups and their dependencies
-- Preserves: schema, enums, auth users, roles, permissions

CREATE OR REPLACE FUNCTION public.dev_reset_master_data()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  deleted_counts json;
BEGIN
  -- ADMIN role check
  IF NOT has_role(auth.uid(), 'ADMIN'::app_role) THEN
    RAISE EXCEPTION 'Only ADMIN can execute this function';
  END IF;

  -- Delete in FK-safe order (children first, parents last)
  
  -- 1. Clear all transactional/production data first
  DELETE FROM ship_picks;
  DELETE FROM inventory_transactions;
  DELETE FROM wip_ledger;
  DELETE FROM wip_adjustments;
  DELETE FROM roast_exception_events;
  DELETE FROM production_checkmarks;
  DELETE FROM production_plan_items;
  DELETE FROM andon_picks;
  DELETE FROM external_demand;
  DELETE FROM order_date_audit_log;
  DELETE FROM order_line_items;
  DELETE FROM orders;
  DELETE FROM packing_runs;
  DELETE FROM roasted_batches;
  
  -- 2. Clear inventory levels
  DELETE FROM fg_inventory;
  DELETE FROM fg_inventory_log;
  DELETE FROM roast_group_inventory_levels;
  
  -- 3. Clear price lists (depend on products)
  DELETE FROM price_list;
  
  -- 4. Clear board configurations (depend on products)
  DELETE FROM source_board_products;
  
  -- 5. Clear client locations (depend on clients)
  DELETE FROM client_locations;
  
  -- 6. Clear products (depend on clients and roast_groups)
  DELETE FROM products;
  
  -- 7. Clear roast groups
  DELETE FROM roast_groups;
  
  -- 8. Clear clients (finally)
  DELETE FROM clients;
  
  -- 9. Clear green coffee lots (standalone)
  DELETE FROM green_coffee_lots;

  -- Build result counts
  SELECT json_build_object(
    'clients', (SELECT COUNT(*) FROM clients),
    'products', (SELECT COUNT(*) FROM products),
    'roast_groups', (SELECT COUNT(*) FROM roast_groups),
    'orders', (SELECT COUNT(*) FROM orders),
    'status', 'success'
  ) INTO result;

  RETURN result;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.dev_reset_master_data() TO authenticated;