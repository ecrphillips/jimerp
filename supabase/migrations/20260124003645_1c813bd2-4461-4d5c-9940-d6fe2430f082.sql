-- Create dev_test_seed_minimal function with ADMIN role enforcement
CREATE OR REPLACE FUNCTION public.dev_test_seed_minimal()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_tomorrow DATE := CURRENT_DATE + 1;
  v_mah_id UUID;
  v_nel_id UUID;
  v_old_id UUID;
  v_fun_id UUID;
  v_order_id UUID;
  v_product_record RECORD;
BEGIN
  -- Verify caller has ADMIN role
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN
    RAISE EXCEPTION 'Access denied: ADMIN role required';
  END IF;

  -- ========== 1) UPSERT CLIENTS ==========
  INSERT INTO clients (name, client_code, is_active)
  VALUES 
    ('Mah', 'MAH', true),
    ('Nelson', 'NEL', true),
    ('Oldhand', 'OLD', true),
    ('Matchstick', 'MAT', true),
    ('Funk', 'FUN', true),
    ('No Smoke', 'NSM', true)
  ON CONFLICT (client_code) DO UPDATE SET 
    name = EXCLUDED.name,
    is_active = true;

  -- Get client IDs
  SELECT id INTO v_mah_id FROM clients WHERE client_code = 'MAH';
  SELECT id INTO v_nel_id FROM clients WHERE client_code = 'NEL';
  SELECT id INTO v_old_id FROM clients WHERE client_code = 'OLD';
  SELECT id INTO v_fun_id FROM clients WHERE client_code = 'FUN';

  -- ========== 2) UPSERT ROAST GROUPS ==========
  INSERT INTO roast_groups (roast_group, standard_batch_kg, expected_yield_loss_pct, default_roaster, is_active)
  VALUES
    ('MEDIUM_ESP_GUA', 20, 16, 'EITHER', true),
    ('MED_DARK_BULLDOG', 20, 16, 'SAMIAC', true),
    ('ETHIOPIA_ESP', 12, 16, 'LORING', true),
    ('LOVE_HOSPITAL', 20, 16, 'EITHER', true),
    ('DECAF', 15, 16, 'EITHER', true),
    ('BRAZIL_BLENDER', 20, 16, 'SAMIAC', true),
    ('RWANDA_FILTER', 12, 16, 'LORING', true)
  ON CONFLICT (roast_group) DO UPDATE SET
    standard_batch_kg = EXCLUDED.standard_batch_kg,
    expected_yield_loss_pct = EXCLUDED.expected_yield_loss_pct,
    default_roaster = EXCLUDED.default_roaster,
    is_active = true;

  -- ========== 3) UPSERT PRODUCTS (MAH/NEL/OLD) ==========
  -- Mah products
  INSERT INTO products (client_id, product_name, sku, bag_size_g, packaging_variant, roast_group, format, is_active)
  VALUES
    (v_mah_id, 'Brazil Espresso 300g', 'MAH-BRAZIL-300G', 300, 'RETAIL_300G', 'BRAZIL_BLENDER', 'WHOLE_BEAN', true),
    (v_mah_id, 'Brazil Espresso 5lb', 'MAH-BRAZIL-5LB', 2270, 'BULK_5LB', 'BRAZIL_BLENDER', 'WHOLE_BEAN', true),
    (v_mah_id, 'Guatemala Espresso 300g', 'MAH-GUA-300G', 300, 'RETAIL_300G', 'MEDIUM_ESP_GUA', 'WHOLE_BEAN', true),
    (v_mah_id, 'Guatemala Espresso 5lb', 'MAH-GUA-5LB', 2270, 'BULK_5LB', 'MEDIUM_ESP_GUA', 'WHOLE_BEAN', true)
  ON CONFLICT (sku) DO UPDATE SET
    product_name = EXCLUDED.product_name,
    bag_size_g = EXCLUDED.bag_size_g,
    packaging_variant = EXCLUDED.packaging_variant,
    roast_group = EXCLUDED.roast_group,
    is_active = true;

  -- Nelson products
  INSERT INTO products (client_id, product_name, sku, bag_size_g, packaging_variant, roast_group, format, is_active)
  VALUES
    (v_nel_id, 'Ethiopia Espresso 300g', 'NEL-ETH-300G', 300, 'RETAIL_300G', 'ETHIOPIA_ESP', 'WHOLE_BEAN', true),
    (v_nel_id, 'Ethiopia Espresso 5lb', 'NEL-ETH-5LB', 2270, 'BULK_5LB', 'ETHIOPIA_ESP', 'WHOLE_BEAN', true),
    (v_nel_id, 'Rwanda Filter 300g', 'NEL-RWA-300G', 300, 'RETAIL_300G', 'RWANDA_FILTER', 'WHOLE_BEAN', true),
    (v_nel_id, 'Rwanda Filter 5lb', 'NEL-RWA-5LB', 2270, 'BULK_5LB', 'RWANDA_FILTER', 'WHOLE_BEAN', true)
  ON CONFLICT (sku) DO UPDATE SET
    product_name = EXCLUDED.product_name,
    bag_size_g = EXCLUDED.bag_size_g,
    packaging_variant = EXCLUDED.packaging_variant,
    roast_group = EXCLUDED.roast_group,
    is_active = true;

  -- Oldhand products
  INSERT INTO products (client_id, product_name, sku, bag_size_g, packaging_variant, roast_group, format, is_active)
  VALUES
    (v_old_id, 'Love Hospital 300g', 'OLD-LOVE-300G', 300, 'RETAIL_300G', 'LOVE_HOSPITAL', 'WHOLE_BEAN', true),
    (v_old_id, 'Love Hospital 5lb', 'OLD-LOVE-5LB', 2270, 'BULK_5LB', 'LOVE_HOSPITAL', 'WHOLE_BEAN', true),
    (v_old_id, 'Yada Yada Yada Decaf 300g', 'OLD-DECAF-300G', 300, 'RETAIL_300G', 'DECAF', 'WHOLE_BEAN', true),
    (v_old_id, 'Yada Yada Yada Decaf 5lb', 'OLD-DECAF-5LB', 2270, 'BULK_5LB', 'DECAF', 'WHOLE_BEAN', true)
  ON CONFLICT (sku) DO UPDATE SET
    product_name = EXCLUDED.product_name,
    bag_size_g = EXCLUDED.bag_size_g,
    packaging_variant = EXCLUDED.packaging_variant,
    roast_group = EXCLUDED.roast_group,
    is_active = true;

  -- Funk Decaf products (board-only, no orders)
  INSERT INTO products (client_id, product_name, sku, bag_size_g, packaging_variant, roast_group, format, is_active)
  VALUES
    (v_fun_id, 'Funk Decaf 250g Can', 'FUN-DECAF-250G-CAN', 250, 'CAN_125G', 'DECAF', 'WHOLE_BEAN', true),
    (v_fun_id, 'Funk Decaf 2lb', 'FUN-DECAF-2LB', 907, 'BULK_2LB', 'DECAF', 'WHOLE_BEAN', true),
    (v_fun_id, 'Funk Decaf 5lb', 'FUN-DECAF-5LB', 2270, 'BULK_5LB', 'DECAF', 'WHOLE_BEAN', true)
  ON CONFLICT (sku) DO UPDATE SET
    product_name = EXCLUDED.product_name,
    bag_size_g = EXCLUDED.bag_size_g,
    packaging_variant = EXCLUDED.packaging_variant,
    roast_group = EXCLUDED.roast_group,
    is_active = true;

  -- ========== 4) UPSERT PRICES (for new products, $0.00) ==========
  INSERT INTO price_list (product_id, unit_price, effective_date, currency)
  SELECT p.id, 0.00, v_today, 'CAD'
  FROM products p
  WHERE p.sku IN (
    'MAH-BRAZIL-300G', 'MAH-BRAZIL-5LB', 'MAH-GUA-300G', 'MAH-GUA-5LB',
    'NEL-ETH-300G', 'NEL-ETH-5LB', 'NEL-RWA-300G', 'NEL-RWA-5LB',
    'OLD-LOVE-300G', 'OLD-LOVE-5LB', 'OLD-DECAF-300G', 'OLD-DECAF-5LB',
    'FUN-DECAF-250G-CAN', 'FUN-DECAF-2LB', 'FUN-DECAF-5LB'
  )
  AND NOT EXISTS (
    SELECT 1 FROM price_list pl WHERE pl.product_id = p.id
  );

  -- ========== 5) DELETE EXISTING SEEDED ORDERS ==========
  DELETE FROM order_line_items
  WHERE order_id IN (
    SELECT id FROM orders
    WHERE created_by_admin = true
    AND client_id IN (v_mah_id, v_nel_id, v_old_id)
    AND requested_ship_date BETWEEN v_today AND v_tomorrow
  );

  DELETE FROM orders
  WHERE created_by_admin = true
  AND client_id IN (v_mah_id, v_nel_id, v_old_id)
  AND requested_ship_date BETWEEN v_today AND v_tomorrow;

  -- ========== 6) CREATE ORDERS FOR MAH (2 today, 1 tomorrow) ==========
  -- Mah Order 1 (today, PICKUP)
  INSERT INTO orders (client_id, status, requested_ship_date, delivery_method, created_by_admin)
  VALUES (v_mah_id, 'CONFIRMED', v_today, 'PICKUP', true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  SELECT v_order_id, id, 8, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'MAH-BRAZIL-300G'
  UNION ALL
  SELECT v_order_id, id, 2, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'MAH-BRAZIL-5LB'
  UNION ALL
  SELECT v_order_id, id, 12, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'MAH-GUA-300G';

  -- Mah Order 2 (today, DELIVERY)
  INSERT INTO orders (client_id, status, requested_ship_date, delivery_method, created_by_admin)
  VALUES (v_mah_id, 'CONFIRMED', v_today, 'DELIVERY', true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  SELECT v_order_id, id, 6, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'MAH-GUA-300G'
  UNION ALL
  SELECT v_order_id, id, 4, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'MAH-GUA-5LB';

  -- Mah Order 3 (tomorrow, COURIER)
  INSERT INTO orders (client_id, status, requested_ship_date, delivery_method, created_by_admin)
  VALUES (v_mah_id, 'CONFIRMED', v_tomorrow, 'COURIER', true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  SELECT v_order_id, id, 10, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'MAH-BRAZIL-300G'
  UNION ALL
  SELECT v_order_id, id, 3, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'MAH-BRAZIL-5LB';

  -- ========== 7) CREATE ORDERS FOR NELSON ==========
  -- Nelson Order 1 (today, PICKUP)
  INSERT INTO orders (client_id, status, requested_ship_date, delivery_method, created_by_admin)
  VALUES (v_nel_id, 'CONFIRMED', v_today, 'PICKUP', true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  SELECT v_order_id, id, 14, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'NEL-ETH-300G'
  UNION ALL
  SELECT v_order_id, id, 5, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'NEL-ETH-5LB'
  UNION ALL
  SELECT v_order_id, id, 6, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'NEL-RWA-300G';

  -- Nelson Order 2 (today, DELIVERY)
  INSERT INTO orders (client_id, status, requested_ship_date, delivery_method, created_by_admin)
  VALUES (v_nel_id, 'CONFIRMED', v_today, 'DELIVERY', true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  SELECT v_order_id, id, 8, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'NEL-RWA-300G'
  UNION ALL
  SELECT v_order_id, id, 2, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'NEL-RWA-5LB';

  -- Nelson Order 3 (tomorrow, PICKUP)
  INSERT INTO orders (client_id, status, requested_ship_date, delivery_method, created_by_admin)
  VALUES (v_nel_id, 'CONFIRMED', v_tomorrow, 'PICKUP', true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  SELECT v_order_id, id, 18, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'NEL-ETH-300G'
  UNION ALL
  SELECT v_order_id, id, 6, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'NEL-ETH-5LB';

  -- ========== 8) CREATE ORDERS FOR OLDHAND ==========
  -- Oldhand Order 1 (today, COURIER)
  INSERT INTO orders (client_id, status, requested_ship_date, delivery_method, created_by_admin)
  VALUES (v_old_id, 'CONFIRMED', v_today, 'COURIER', true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  SELECT v_order_id, id, 10, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'OLD-LOVE-300G'
  UNION ALL
  SELECT v_order_id, id, 3, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'OLD-LOVE-5LB'
  UNION ALL
  SELECT v_order_id, id, 8, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'OLD-DECAF-300G';

  -- Oldhand Order 2 (today, PICKUP)
  INSERT INTO orders (client_id, status, requested_ship_date, delivery_method, created_by_admin)
  VALUES (v_old_id, 'CONFIRMED', v_today, 'PICKUP', true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  SELECT v_order_id, id, 4, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'OLD-DECAF-300G'
  UNION ALL
  SELECT v_order_id, id, 2, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'OLD-DECAF-5LB';

  -- Oldhand Order 3 (tomorrow, DELIVERY)
  INSERT INTO orders (client_id, status, requested_ship_date, delivery_method, created_by_admin)
  VALUES (v_old_id, 'CONFIRMED', v_tomorrow, 'DELIVERY', true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  SELECT v_order_id, id, 16, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'OLD-LOVE-300G'
  UNION ALL
  SELECT v_order_id, id, 4, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'OLD-LOVE-5LB'
  UNION ALL
  SELECT v_order_id, id, 6, 'WHOLE_BEAN', 0.00 FROM products WHERE sku = 'OLD-DECAF-5LB';

END;
$$;

-- Grant execute to authenticated users (function itself checks role)
GRANT EXECUTE ON FUNCTION public.dev_test_seed_minimal() TO authenticated;