-- Safe delete functions for Clients, Products, and Roast Groups
-- These run in transactions and check for references before deleting

-- Helper function to check counts for a client
CREATE OR REPLACE FUNCTION public.get_client_delete_preflight(p_client_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open_count INTEGER;
  v_completed_count INTEGER;
  v_cancelled_count INTEGER;
  v_product_count INTEGER;
BEGIN
  -- Count open orders (not SHIPPED or CANCELLED)
  SELECT COUNT(*) INTO v_open_count
  FROM orders
  WHERE client_id = p_client_id
    AND status NOT IN ('SHIPPED', 'CANCELLED');

  -- Count completed orders
  SELECT COUNT(*) INTO v_completed_count
  FROM orders
  WHERE client_id = p_client_id
    AND status = 'SHIPPED';

  -- Count cancelled orders
  SELECT COUNT(*) INTO v_cancelled_count
  FROM orders
  WHERE client_id = p_client_id
    AND status = 'CANCELLED';

  -- Count products
  SELECT COUNT(*) INTO v_product_count
  FROM products
  WHERE client_id = p_client_id;

  RETURN jsonb_build_object(
    'open_orders', v_open_count,
    'completed_orders', v_completed_count,
    'cancelled_orders', v_cancelled_count,
    'products', v_product_count
  );
END;
$$;

-- Delete client function
CREATE OR REPLACE FUNCTION public.delete_client_safe(p_client_id UUID, p_force BOOLEAN DEFAULT FALSE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts jsonb;
  v_user_id UUID := auth.uid();
BEGIN
  -- Only ADMIN/OPS can delete
  IF NOT (public.has_role(v_user_id, 'ADMIN') OR public.has_role(v_user_id, 'OPS')) THEN
    RAISE EXCEPTION 'Access denied: ADMIN or OPS role required';
  END IF;

  -- Get preflight counts
  v_counts := public.get_client_delete_preflight(p_client_id);

  -- If there are references and force is false, just return counts
  IF NOT p_force AND (
    (v_counts->>'open_orders')::INTEGER > 0 OR
    (v_counts->>'completed_orders')::INTEGER > 0
  ) THEN
    RETURN jsonb_build_object(
      'deleted', false,
      'counts', v_counts,
      'message', 'Client has orders. Use force=true to delete.'
    );
  END IF;

  -- Cancel all open orders first
  UPDATE orders
  SET status = 'CANCELLED', updated_at = now()
  WHERE client_id = p_client_id
    AND status NOT IN ('SHIPPED', 'CANCELLED');

  -- Delete in FK-safe order:
  -- 1. ship_picks (references order_line_items)
  DELETE FROM ship_picks
  WHERE order_id IN (SELECT id FROM orders WHERE client_id = p_client_id);

  -- 2. order_line_items
  DELETE FROM order_line_items
  WHERE order_id IN (SELECT id FROM orders WHERE client_id = p_client_id);

  -- 3. order_date_audit_log
  DELETE FROM order_date_audit_log
  WHERE order_id IN (SELECT id FROM orders WHERE client_id = p_client_id);

  -- 4. production_plan_items
  DELETE FROM production_plan_items
  WHERE client_id = p_client_id;

  -- 5. orders
  DELETE FROM orders
  WHERE client_id = p_client_id;

  -- 6. Product-related tables
  DELETE FROM andon_picks
  WHERE product_id IN (SELECT id FROM products WHERE client_id = p_client_id);

  DELETE FROM source_board_products
  WHERE product_id IN (SELECT id FROM products WHERE client_id = p_client_id);

  DELETE FROM packing_runs
  WHERE product_id IN (SELECT id FROM products WHERE client_id = p_client_id);

  DELETE FROM production_checkmarks
  WHERE product_id IN (SELECT id FROM products WHERE client_id = p_client_id);

  DELETE FROM fg_inventory
  WHERE product_id IN (SELECT id FROM products WHERE client_id = p_client_id);

  DELETE FROM fg_inventory_log
  WHERE product_id IN (SELECT id FROM products WHERE client_id = p_client_id);

  DELETE FROM price_list
  WHERE product_id IN (SELECT id FROM products WHERE client_id = p_client_id);

  DELETE FROM external_demand
  WHERE product_id IN (SELECT id FROM products WHERE client_id = p_client_id);

  DELETE FROM inventory_transactions
  WHERE product_id IN (SELECT id FROM products WHERE client_id = p_client_id);

  -- 7. products
  DELETE FROM products
  WHERE client_id = p_client_id;

  -- 8. client_locations
  DELETE FROM client_locations
  WHERE client_id = p_client_id;

  -- 9. user_roles referencing this client
  DELETE FROM user_roles
  WHERE client_id = p_client_id;

  -- 10. Finally delete the client
  DELETE FROM clients
  WHERE id = p_client_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'counts', v_counts,
    'message', 'Client and all related data deleted successfully'
  );
END;
$$;

-- Helper function to check counts for a product
CREATE OR REPLACE FUNCTION public.get_product_delete_preflight(p_product_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open_count INTEGER;
  v_completed_count INTEGER;
  v_cancelled_count INTEGER;
BEGIN
  -- Count open orders containing this product
  SELECT COUNT(DISTINCT o.id) INTO v_open_count
  FROM orders o
  INNER JOIN order_line_items oli ON oli.order_id = o.id
  WHERE oli.product_id = p_product_id
    AND o.status NOT IN ('SHIPPED', 'CANCELLED');

  -- Count completed orders
  SELECT COUNT(DISTINCT o.id) INTO v_completed_count
  FROM orders o
  INNER JOIN order_line_items oli ON oli.order_id = o.id
  WHERE oli.product_id = p_product_id
    AND o.status = 'SHIPPED';

  -- Count cancelled orders
  SELECT COUNT(DISTINCT o.id) INTO v_cancelled_count
  FROM orders o
  INNER JOIN order_line_items oli ON oli.order_id = o.id
  WHERE oli.product_id = p_product_id
    AND o.status = 'CANCELLED';

  RETURN jsonb_build_object(
    'open_orders', v_open_count,
    'completed_orders', v_completed_count,
    'cancelled_orders', v_cancelled_count
  );
END;
$$;

-- Delete product function
CREATE OR REPLACE FUNCTION public.delete_product_safe(p_product_id UUID, p_force BOOLEAN DEFAULT FALSE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts jsonb;
  v_user_id UUID := auth.uid();
  v_order_ids UUID[];
BEGIN
  -- Only ADMIN/OPS can delete
  IF NOT (public.has_role(v_user_id, 'ADMIN') OR public.has_role(v_user_id, 'OPS')) THEN
    RAISE EXCEPTION 'Access denied: ADMIN or OPS role required';
  END IF;

  -- Get preflight counts
  v_counts := public.get_product_delete_preflight(p_product_id);

  -- If there are references and force is false, just return counts
  IF NOT p_force AND (
    (v_counts->>'open_orders')::INTEGER > 0 OR
    (v_counts->>'completed_orders')::INTEGER > 0
  ) THEN
    RETURN jsonb_build_object(
      'deleted', false,
      'counts', v_counts,
      'message', 'Product is used in orders. Use force=true to delete.'
    );
  END IF;

  -- Get open order IDs containing this product
  SELECT ARRAY_AGG(DISTINCT o.id) INTO v_order_ids
  FROM orders o
  INNER JOIN order_line_items oli ON oli.order_id = o.id
  WHERE oli.product_id = p_product_id
    AND o.status NOT IN ('SHIPPED', 'CANCELLED');

  -- Cancel these orders
  IF v_order_ids IS NOT NULL THEN
    UPDATE orders
    SET status = 'CANCELLED', updated_at = now()
    WHERE id = ANY(v_order_ids);
  END IF;

  -- Delete dependent references in FK-safe order
  DELETE FROM ship_picks
  WHERE order_line_item_id IN (SELECT id FROM order_line_items WHERE product_id = p_product_id);

  DELETE FROM order_line_items
  WHERE product_id = p_product_id;

  DELETE FROM andon_picks
  WHERE product_id = p_product_id;

  DELETE FROM source_board_products
  WHERE product_id = p_product_id;

  DELETE FROM packing_runs
  WHERE product_id = p_product_id;

  DELETE FROM production_checkmarks
  WHERE product_id = p_product_id;

  DELETE FROM production_plan_items
  WHERE product_id = p_product_id;

  DELETE FROM fg_inventory
  WHERE product_id = p_product_id;

  DELETE FROM fg_inventory_log
  WHERE product_id = p_product_id;

  DELETE FROM price_list
  WHERE product_id = p_product_id;

  DELETE FROM external_demand
  WHERE product_id = p_product_id;

  DELETE FROM inventory_transactions
  WHERE product_id = p_product_id;

  DELETE FROM wip_ledger
  WHERE related_product_id = p_product_id;

  -- Finally delete the product
  DELETE FROM products
  WHERE id = p_product_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'counts', v_counts,
    'message', 'Product and all related data deleted successfully'
  );
END;
$$;

-- Helper function to check counts for a roast group
CREATE OR REPLACE FUNCTION public.get_roast_group_delete_preflight(p_roast_group TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_count INTEGER;
  v_batch_count INTEGER;
  v_open_order_count INTEGER;
BEGIN
  -- Count products using this roast group
  SELECT COUNT(*) INTO v_product_count
  FROM products
  WHERE roast_group = p_roast_group;

  -- Count roasted batches
  SELECT COUNT(*) INTO v_batch_count
  FROM roasted_batches
  WHERE roast_group = p_roast_group;

  -- Count open orders with products from this roast group
  SELECT COUNT(DISTINCT o.id) INTO v_open_order_count
  FROM orders o
  INNER JOIN order_line_items oli ON oli.order_id = o.id
  INNER JOIN products p ON p.id = oli.product_id
  WHERE p.roast_group = p_roast_group
    AND o.status NOT IN ('SHIPPED', 'CANCELLED');

  RETURN jsonb_build_object(
    'products', v_product_count,
    'batches', v_batch_count,
    'open_orders', v_open_order_count
  );
END;
$$;

-- Delete roast group function
CREATE OR REPLACE FUNCTION public.delete_roast_group_safe(p_roast_group TEXT, p_force BOOLEAN DEFAULT FALSE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts jsonb;
  v_user_id UUID := auth.uid();
BEGIN
  -- Only ADMIN/OPS can delete
  IF NOT (public.has_role(v_user_id, 'ADMIN') OR public.has_role(v_user_id, 'OPS')) THEN
    RAISE EXCEPTION 'Access denied: ADMIN or OPS role required';
  END IF;

  -- Get preflight counts
  v_counts := public.get_roast_group_delete_preflight(p_roast_group);

  -- Block delete if products exist (user must delete/move products first)
  IF (v_counts->>'products')::INTEGER > 0 THEN
    RETURN jsonb_build_object(
      'deleted', false,
      'counts', v_counts,
      'blocked', true,
      'message', 'This roast group still has products. Move products to another roast group or delete the products first.'
    );
  END IF;

  -- If there are batches and force is false, just return counts
  IF NOT p_force AND (v_counts->>'batches')::INTEGER > 0 THEN
    RETURN jsonb_build_object(
      'deleted', false,
      'counts', v_counts,
      'message', 'Roast group has batch history. Use force=true to delete.'
    );
  END IF;

  -- Delete dependent data
  DELETE FROM roast_exception_events
  WHERE roast_group = p_roast_group;

  DELETE FROM wip_ledger
  WHERE roast_group = p_roast_group;

  DELETE FROM roasted_batches
  WHERE roast_group = p_roast_group;

  DELETE FROM wip_adjustments
  WHERE roast_group = p_roast_group;

  DELETE FROM roast_group_inventory_levels
  WHERE roast_group = p_roast_group;

  DELETE FROM inventory_transactions
  WHERE roast_group = p_roast_group;

  -- Finally delete the roast group
  DELETE FROM roast_groups
  WHERE roast_group = p_roast_group;

  RETURN jsonb_build_object(
    'deleted', true,
    'counts', v_counts,
    'message', 'Roast group and all related data deleted successfully'
  );
END;
$$;