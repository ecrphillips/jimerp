-- =====================================================
-- Fix: Add authorization checks to preflight RPC functions
-- These functions expose business data and must require ADMIN/OPS role
-- =====================================================

-- Drop and recreate get_order_delete_preflight to match the corrected return type
DROP FUNCTION IF EXISTS public.get_order_delete_preflight(UUID);

-- 1. Secure get_client_delete_preflight
CREATE OR REPLACE FUNCTION public.get_client_delete_preflight(p_client_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name TEXT;
  v_open_orders INTEGER;
  v_completed_orders INTEGER;
  v_cancelled_orders INTEGER;
  v_products INTEGER;
BEGIN
  -- Authorization: Only ADMIN or OPS can access preflight data
  IF NOT (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS')) THEN
    RAISE EXCEPTION 'Access denied: ADMIN or OPS role required';
  END IF;

  SELECT name INTO v_client_name FROM clients WHERE id = p_client_id;
  
  IF v_client_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Client not found');
  END IF;

  SELECT COUNT(*) INTO v_open_orders 
  FROM orders 
  WHERE client_id = p_client_id 
    AND status NOT IN ('SHIPPED', 'CANCELLED');

  SELECT COUNT(*) INTO v_completed_orders 
  FROM orders 
  WHERE client_id = p_client_id 
    AND status = 'SHIPPED';

  SELECT COUNT(*) INTO v_cancelled_orders 
  FROM orders 
  WHERE client_id = p_client_id 
    AND status = 'CANCELLED';

  SELECT COUNT(*) INTO v_products 
  FROM products 
  WHERE client_id = p_client_id;

  RETURN jsonb_build_object(
    'client_name', v_client_name,
    'open_orders', v_open_orders,
    'completed_orders', v_completed_orders,
    'cancelled_orders', v_cancelled_orders,
    'products', v_products,
    'can_delete', v_open_orders = 0 AND v_products = 0
  );
END;
$$;

-- 2. Secure get_product_delete_preflight
CREATE OR REPLACE FUNCTION public.get_product_delete_preflight(p_product_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_name TEXT;
  v_client_name TEXT;
  v_open_orders INTEGER;
  v_completed_orders INTEGER;
  v_cancelled_orders INTEGER;
BEGIN
  -- Authorization: Only ADMIN or OPS can access preflight data
  IF NOT (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS')) THEN
    RAISE EXCEPTION 'Access denied: ADMIN or OPS role required';
  END IF;

  SELECT p.product_name, c.name INTO v_product_name, v_client_name
  FROM products p
  JOIN clients c ON c.id = p.client_id
  WHERE p.id = p_product_id;
  
  IF v_product_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Product not found');
  END IF;

  SELECT COUNT(*) INTO v_open_orders 
  FROM order_line_items oli
  JOIN orders o ON o.id = oli.order_id
  WHERE oli.product_id = p_product_id 
    AND o.status NOT IN ('SHIPPED', 'CANCELLED');

  SELECT COUNT(*) INTO v_completed_orders 
  FROM order_line_items oli
  JOIN orders o ON o.id = oli.order_id
  WHERE oli.product_id = p_product_id 
    AND o.status = 'SHIPPED';

  SELECT COUNT(*) INTO v_cancelled_orders 
  FROM order_line_items oli
  JOIN orders o ON o.id = oli.order_id
  WHERE oli.product_id = p_product_id 
    AND o.status = 'CANCELLED';

  RETURN jsonb_build_object(
    'product_name', v_product_name,
    'client_name', v_client_name,
    'open_orders', v_open_orders,
    'completed_orders', v_completed_orders,
    'cancelled_orders', v_cancelled_orders,
    'can_delete', v_open_orders = 0
  );
END;
$$;

-- 3. Secure get_roast_group_delete_preflight
CREATE OR REPLACE FUNCTION public.get_roast_group_delete_preflight(p_roast_group TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_display_name TEXT;
  v_products INTEGER;
  v_batches INTEGER;
  v_open_orders INTEGER;
BEGIN
  -- Authorization: Only ADMIN or OPS can access preflight data
  IF NOT (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS')) THEN
    RAISE EXCEPTION 'Access denied: ADMIN or OPS role required';
  END IF;

  SELECT display_name INTO v_display_name 
  FROM roast_groups 
  WHERE roast_group = p_roast_group;
  
  IF v_display_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Roast group not found');
  END IF;

  SELECT COUNT(*) INTO v_products 
  FROM products 
  WHERE roast_group = p_roast_group;

  SELECT COUNT(*) INTO v_batches 
  FROM roasted_batches 
  WHERE roast_group = p_roast_group;

  SELECT COUNT(DISTINCT o.id) INTO v_open_orders 
  FROM orders o
  JOIN order_line_items oli ON oli.order_id = o.id
  JOIN products p ON p.id = oli.product_id
  WHERE p.roast_group = p_roast_group 
    AND o.status NOT IN ('SHIPPED', 'CANCELLED');

  RETURN jsonb_build_object(
    'display_name', v_display_name,
    'products', v_products,
    'batches', v_batches,
    'open_orders', v_open_orders,
    'can_delete', v_products = 0 AND v_batches = 0
  );
END;
$$;

-- 4. Recreate get_order_delete_preflight with authorization (using jsonb for consistency)
CREATE FUNCTION public.get_order_delete_preflight(p_order_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_number TEXT;
  v_client_name TEXT;
  v_status TEXT;
  v_line_items INTEGER;
  v_inventory_transactions INTEGER;
  v_ship_picks INTEGER;
BEGIN
  -- Authorization: Only ADMIN or OPS can access preflight data
  IF NOT (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS')) THEN
    RAISE EXCEPTION 'Access denied: ADMIN or OPS role required';
  END IF;

  SELECT o.order_number, c.name, o.status::TEXT 
  INTO v_order_number, v_client_name, v_status
  FROM orders o
  JOIN clients c ON c.id = o.client_id
  WHERE o.id = p_order_id;
  
  IF v_order_number IS NULL THEN
    RETURN jsonb_build_object('error', 'Order not found');
  END IF;

  SELECT COUNT(*) INTO v_line_items 
  FROM order_line_items 
  WHERE order_id = p_order_id;

  SELECT COUNT(*) INTO v_inventory_transactions 
  FROM inventory_transactions 
  WHERE order_id = p_order_id;

  SELECT COUNT(*) INTO v_ship_picks 
  FROM ship_picks 
  WHERE order_id = p_order_id;

  RETURN jsonb_build_object(
    'order_number', v_order_number,
    'client_name', v_client_name,
    'status', v_status,
    'line_items', v_line_items,
    'inventory_transactions', v_inventory_transactions,
    'ship_picks', v_ship_picks,
    'can_delete', v_status IN ('DRAFT', 'SUBMITTED', 'CANCELLED')
  );
END;
$$;