-- Function to get order deletion preflight data
CREATE OR REPLACE FUNCTION public.get_order_delete_preflight(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_exists boolean;
  v_order_number text;
  v_order_status text;
  v_line_items_count int;
  v_ship_picks_count int;
  v_ship_picks_units int;
  v_inventory_txns_count int;
  v_production_plan_count int;
BEGIN
  -- Check order exists
  SELECT EXISTS(SELECT 1 FROM orders WHERE id = p_order_id) INTO v_order_exists;
  IF NOT v_order_exists THEN
    RETURN json_build_object('error', 'Order not found');
  END IF;

  -- Get order info
  SELECT order_number, status INTO v_order_number, v_order_status
  FROM orders WHERE id = p_order_id;

  -- Count line items
  SELECT COUNT(*) INTO v_line_items_count
  FROM order_line_items WHERE order_id = p_order_id;

  -- Count ship picks (units picked for this order)
  SELECT COUNT(*), COALESCE(SUM(units_picked), 0) INTO v_ship_picks_count, v_ship_picks_units
  FROM ship_picks WHERE order_id = p_order_id;

  -- Count inventory transactions referencing this order
  SELECT COUNT(*) INTO v_inventory_txns_count
  FROM inventory_transactions WHERE order_id = p_order_id;

  -- Count production plan items
  SELECT COUNT(*) INTO v_production_plan_count
  FROM production_plan_items WHERE order_id = p_order_id;

  RETURN json_build_object(
    'order_number', v_order_number,
    'order_status', v_order_status,
    'line_items_count', v_line_items_count,
    'ship_picks_count', v_ship_picks_count,
    'ship_picks_units', v_ship_picks_units,
    'inventory_txns_count', v_inventory_txns_count,
    'production_plan_count', v_production_plan_count
  );
END;
$$;

-- Function to delete order with full cascade and inventory reversal
CREATE OR REPLACE FUNCTION public.delete_order_safe(p_order_id uuid, p_force boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_exists boolean;
  v_order_number text;
  v_line_items_deleted int := 0;
  v_ship_picks_deleted int := 0;
  v_inventory_txns_reversed int := 0;
  v_production_plan_deleted int := 0;
  v_txn record;
BEGIN
  -- Check order exists
  SELECT EXISTS(SELECT 1 FROM orders WHERE id = p_order_id) INTO v_order_exists;
  IF NOT v_order_exists THEN
    RETURN json_build_object('success', false, 'error', 'Order not found');
  END IF;

  -- Get order number for logging
  SELECT order_number INTO v_order_number FROM orders WHERE id = p_order_id;

  -- STEP 1: Reverse inventory transactions for this order
  -- For SHIP_CONSUME_FG transactions, we need to add back the units to FG inventory
  FOR v_txn IN 
    SELECT * FROM inventory_transactions 
    WHERE order_id = p_order_id
  LOOP
    -- Reverse FG inventory effects
    IF v_txn.transaction_type = 'SHIP_CONSUME_FG' AND v_txn.product_id IS NOT NULL THEN
      -- SHIP_CONSUME_FG has negative quantity_units, so reversing means adding back (negating)
      UPDATE fg_inventory 
      SET units_on_hand = units_on_hand + ABS(COALESCE(v_txn.quantity_units, 0)),
          updated_at = now()
      WHERE product_id = v_txn.product_id;
      
      -- Log the reversal
      INSERT INTO fg_inventory_log (product_id, units_delta, units_after, notes)
      SELECT 
        v_txn.product_id,
        ABS(COALESCE(v_txn.quantity_units, 0)),
        fi.units_on_hand,
        'Reversed due to order deletion: ' || v_order_number
      FROM fg_inventory fi WHERE fi.product_id = v_txn.product_id;
    END IF;
    
    v_inventory_txns_reversed := v_inventory_txns_reversed + 1;
  END LOOP;

  -- Delete inventory transactions for this order
  DELETE FROM inventory_transactions WHERE order_id = p_order_id;

  -- STEP 2: Delete ship picks
  DELETE FROM ship_picks WHERE order_id = p_order_id;
  GET DIAGNOSTICS v_ship_picks_deleted = ROW_COUNT;

  -- STEP 3: Delete production plan items
  DELETE FROM production_plan_items WHERE order_id = p_order_id;
  GET DIAGNOSTICS v_production_plan_deleted = ROW_COUNT;

  -- STEP 4: Delete order line items
  DELETE FROM order_line_items WHERE order_id = p_order_id;
  GET DIAGNOSTICS v_line_items_deleted = ROW_COUNT;

  -- STEP 5: Delete order date audit log entries
  DELETE FROM order_date_audit_log WHERE order_id = p_order_id;

  -- STEP 6: Delete the order itself
  DELETE FROM orders WHERE id = p_order_id;

  RETURN json_build_object(
    'success', true,
    'order_number', v_order_number,
    'deleted', json_build_object(
      'line_items', v_line_items_deleted,
      'ship_picks', v_ship_picks_deleted,
      'inventory_txns_reversed', v_inventory_txns_reversed,
      'production_plan_items', v_production_plan_deleted
    )
  );
END;
$$;