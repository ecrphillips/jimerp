-- Update dev_test_seed_minimal to create realistic production data
CREATE OR REPLACE FUNCTION public.dev_test_seed_minimal()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_next_week DATE := CURRENT_DATE + 7;
  v_mat_id UUID;
  v_fun_id UUID;
  v_mah_id UUID;
  v_nsm_id UUID;
  v_nel_id UUID;
  v_old_id UUID;
  v_order_id UUID;
  v_product_id UUID;
BEGIN
  -- Verify caller has ADMIN role
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN
    RAISE EXCEPTION 'Access denied: ADMIN role required';
  END IF;

  -- ========== 1) UPSERT CLIENTS ==========
  INSERT INTO clients (name, client_code, is_active)
  VALUES 
    ('Matchstick', 'MAT', true),
    ('Funk', 'FUN', true),
    ('Mah', 'MAH', true),
    ('No Smoke', 'NSM', true),
    ('Nelson', 'NEL', true),
    ('Oldhand', 'OLD', true)
  ON CONFLICT (client_code) DO UPDATE SET 
    name = EXCLUDED.name,
    is_active = true;

  -- Get client IDs
  SELECT id INTO v_mat_id FROM clients WHERE client_code = 'MAT';
  SELECT id INTO v_fun_id FROM clients WHERE client_code = 'FUN';
  SELECT id INTO v_mah_id FROM clients WHERE client_code = 'MAH';
  SELECT id INTO v_nsm_id FROM clients WHERE client_code = 'NSM';
  SELECT id INTO v_nel_id FROM clients WHERE client_code = 'NEL';
  SELECT id INTO v_old_id FROM clients WHERE client_code = 'OLD';

  -- ========== 2) UPSERT ROAST GROUPS ==========
  INSERT INTO roast_groups (roast_group, standard_batch_kg, expected_yield_loss_pct, default_roaster, is_active, display_order)
  VALUES
    ('CATALOGUE', 20, 16, 'LORING'::default_roaster, true, 1),
    ('BULLDOG', 20, 16, 'SAMIAC'::default_roaster, true, 2),
    ('DECAF', 15, 18, 'LORING'::default_roaster, true, 3),
    ('TECHNICOLOUR', 20, 16, 'LORING'::default_roaster, true, 4),
    ('MONOCHROME', 18, 16, 'LORING'::default_roaster, true, 5),
    ('MELLOW_CARMELLO', 18, 16, 'SAMIAC'::default_roaster, true, 6),
    ('GUATEMALA_ESP', 20, 16, 'EITHER'::default_roaster, true, 7),
    ('BRAZIL_ESP', 20, 16, 'SAMIAC'::default_roaster, true, 8),
    ('ETHIOPIA_ESP', 12, 16, 'LORING'::default_roaster, true, 9),
    ('RWANDA_FILTER', 12, 16, 'LORING'::default_roaster, true, 10),
    ('LOVE_HOSPITAL', 20, 16, 'EITHER'::default_roaster, true, 11),
    ('NSM_HOUSE', 15, 16, 'SAMIAC'::default_roaster, true, 12)
  ON CONFLICT (roast_group) DO UPDATE SET
    standard_batch_kg = EXCLUDED.standard_batch_kg,
    expected_yield_loss_pct = EXCLUDED.expected_yield_loss_pct,
    default_roaster = EXCLUDED.default_roaster,
    display_order = EXCLUDED.display_order,
    is_active = true;

  -- ========== 3) UPSERT PRODUCTS ==========
  
  -- MATCHSTICK Products (Catalogue, Bulldog, Decaf)
  INSERT INTO products (client_id, product_name, sku, bag_size_g, packaging_variant, roast_group, format, is_active)
  VALUES
    -- Catalogue
    (v_mat_id, 'Catalogue 5lb', 'MAT-CAT-5LB', 2270, 'BULK_5LB'::packaging_variant, 'CATALOGUE', 'WHOLE_BEAN'::product_format, true),
    (v_mat_id, 'Catalogue 340g', 'MAT-CAT-340G', 340, 'RETAIL_340G'::packaging_variant, 'CATALOGUE', 'WHOLE_BEAN'::product_format, true),
    -- Bulldog
    (v_mat_id, 'Bulldog 5lb', 'MAT-BULL-5LB', 2270, 'BULK_5LB'::packaging_variant, 'BULLDOG', 'WHOLE_BEAN'::product_format, true),
    (v_mat_id, 'Bulldog 340g', 'MAT-BULL-340G', 340, 'RETAIL_340G'::packaging_variant, 'BULLDOG', 'WHOLE_BEAN'::product_format, true),
    -- Decaf
    (v_mat_id, 'Matchstick Decaf 5lb', 'MAT-DECAF-5LB', 2270, 'BULK_5LB'::packaging_variant, 'DECAF', 'WHOLE_BEAN'::product_format, true),
    (v_mat_id, 'Matchstick Decaf 340g', 'MAT-DECAF-340G', 340, 'RETAIL_340G'::packaging_variant, 'DECAF', 'WHOLE_BEAN'::product_format, true)
  ON CONFLICT (sku) DO UPDATE SET
    product_name = EXCLUDED.product_name,
    bag_size_g = EXCLUDED.bag_size_g,
    packaging_variant = EXCLUDED.packaging_variant,
    roast_group = EXCLUDED.roast_group,
    is_active = true;

  -- FUNK Products
  INSERT INTO products (client_id, product_name, sku, bag_size_g, packaging_variant, roast_group, format, is_active)
  VALUES
    -- Technicolour Espresso
    (v_fun_id, 'Technicolour 5lb', 'FUN-TECH-5LB', 2270, 'BULK_5LB'::packaging_variant, 'TECHNICOLOUR', 'WHOLE_BEAN'::product_format, true),
    (v_fun_id, 'Technicolour 2lb', 'FUN-TECH-2LB', 907, 'BULK_2LB'::packaging_variant, 'TECHNICOLOUR', 'WHOLE_BEAN'::product_format, true),
    (v_fun_id, 'Technicolour 250g', 'FUN-TECH-250G', 250, 'RETAIL_250G'::packaging_variant, 'TECHNICOLOUR', 'WHOLE_BEAN'::product_format, true),
    -- Monochrome
    (v_fun_id, 'Monochrome 5lb', 'FUN-MONO-5LB', 2270, 'BULK_5LB'::packaging_variant, 'MONOCHROME', 'WHOLE_BEAN'::product_format, true),
    (v_fun_id, 'Monochrome 2lb', 'FUN-MONO-2LB', 907, 'BULK_2LB'::packaging_variant, 'MONOCHROME', 'WHOLE_BEAN'::product_format, true),
    (v_fun_id, 'Monochrome 250g', 'FUN-MONO-250G', 250, 'RETAIL_250G'::packaging_variant, 'MONOCHROME', 'WHOLE_BEAN'::product_format, true),
    -- Mellow Carmello
    (v_fun_id, 'Mellow Carmello 5lb', 'FUN-MELL-5LB', 2270, 'BULK_5LB'::packaging_variant, 'MELLOW_CARMELLO', 'WHOLE_BEAN'::product_format, true),
    (v_fun_id, 'Mellow Carmello 2lb', 'FUN-MELL-2LB', 907, 'BULK_2LB'::packaging_variant, 'MELLOW_CARMELLO', 'WHOLE_BEAN'::product_format, true),
    (v_fun_id, 'Mellow Carmello 250g', 'FUN-MELL-250G', 250, 'RETAIL_250G'::packaging_variant, 'MELLOW_CARMELLO', 'WHOLE_BEAN'::product_format, true),
    -- Funk Decaf
    (v_fun_id, 'Funk Decaf 5lb', 'FUN-DECAF-5LB', 2270, 'BULK_5LB'::packaging_variant, 'DECAF', 'WHOLE_BEAN'::product_format, true),
    (v_fun_id, 'Funk Decaf 2lb', 'FUN-DECAF-2LB', 907, 'BULK_2LB'::packaging_variant, 'DECAF', 'WHOLE_BEAN'::product_format, true),
    (v_fun_id, 'Funk Decaf 250g', 'FUN-DECAF-250G', 250, 'RETAIL_250G'::packaging_variant, 'DECAF', 'WHOLE_BEAN'::product_format, true)
  ON CONFLICT (sku) DO UPDATE SET
    product_name = EXCLUDED.product_name,
    bag_size_g = EXCLUDED.bag_size_g,
    packaging_variant = EXCLUDED.packaging_variant,
    roast_group = EXCLUDED.roast_group,
    is_active = true;

  -- MAH Products
  INSERT INTO products (client_id, product_name, sku, bag_size_g, packaging_variant, roast_group, format, is_active)
  VALUES
    (v_mah_id, 'Guatemala Espresso 5lb', 'MAH-GUA-5LB', 2270, 'BULK_5LB'::packaging_variant, 'GUATEMALA_ESP', 'WHOLE_BEAN'::product_format, true),
    (v_mah_id, 'Guatemala Espresso 300g', 'MAH-GUA-300G', 300, 'RETAIL_300G'::packaging_variant, 'GUATEMALA_ESP', 'WHOLE_BEAN'::product_format, true),
    (v_mah_id, 'Brazil Espresso 5lb', 'MAH-BRAZIL-5LB', 2270, 'BULK_5LB'::packaging_variant, 'BRAZIL_ESP', 'WHOLE_BEAN'::product_format, true),
    (v_mah_id, 'Brazil Espresso 300g', 'MAH-BRAZIL-300G', 300, 'RETAIL_300G'::packaging_variant, 'BRAZIL_ESP', 'WHOLE_BEAN'::product_format, true)
  ON CONFLICT (sku) DO UPDATE SET
    product_name = EXCLUDED.product_name,
    bag_size_g = EXCLUDED.bag_size_g,
    packaging_variant = EXCLUDED.packaging_variant,
    roast_group = EXCLUDED.roast_group,
    is_active = true;

  -- NO SMOKE Products
  INSERT INTO products (client_id, product_name, sku, bag_size_g, packaging_variant, roast_group, format, is_active)
  VALUES
    (v_nsm_id, 'NSM House Blend 340g', 'NSM-HOUSE-340G', 340, 'RETAIL_340G'::packaging_variant, 'NSM_HOUSE', 'WHOLE_BEAN'::product_format, true),
    (v_nsm_id, 'NSM House Blend 5lb', 'NSM-HOUSE-5LB', 2270, 'BULK_5LB'::packaging_variant, 'NSM_HOUSE', 'WHOLE_BEAN'::product_format, true),
    (v_nsm_id, 'NSM Decaf 340g', 'NSM-DECAF-340G', 340, 'RETAIL_340G'::packaging_variant, 'DECAF', 'WHOLE_BEAN'::product_format, true)
  ON CONFLICT (sku) DO UPDATE SET
    product_name = EXCLUDED.product_name,
    bag_size_g = EXCLUDED.bag_size_g,
    packaging_variant = EXCLUDED.packaging_variant,
    roast_group = EXCLUDED.roast_group,
    is_active = true;

  -- NELSON Products
  INSERT INTO products (client_id, product_name, sku, bag_size_g, packaging_variant, roast_group, format, is_active)
  VALUES
    (v_nel_id, 'Ethiopia Espresso 5lb', 'NEL-ETH-5LB', 2270, 'BULK_5LB'::packaging_variant, 'ETHIOPIA_ESP', 'WHOLE_BEAN'::product_format, true),
    (v_nel_id, 'Ethiopia Espresso 300g', 'NEL-ETH-300G', 300, 'RETAIL_300G'::packaging_variant, 'ETHIOPIA_ESP', 'WHOLE_BEAN'::product_format, true),
    (v_nel_id, 'Rwanda Filter 5lb', 'NEL-RWA-5LB', 2270, 'BULK_5LB'::packaging_variant, 'RWANDA_FILTER', 'WHOLE_BEAN'::product_format, true),
    (v_nel_id, 'Rwanda Filter 300g', 'NEL-RWA-300G', 300, 'RETAIL_300G'::packaging_variant, 'RWANDA_FILTER', 'WHOLE_BEAN'::product_format, true)
  ON CONFLICT (sku) DO UPDATE SET
    product_name = EXCLUDED.product_name,
    bag_size_g = EXCLUDED.bag_size_g,
    packaging_variant = EXCLUDED.packaging_variant,
    roast_group = EXCLUDED.roast_group,
    is_active = true;

  -- OLDHAND Products
  INSERT INTO products (client_id, product_name, sku, bag_size_g, packaging_variant, roast_group, format, is_active)
  VALUES
    (v_old_id, 'Love Hospital 5lb', 'OLD-LOVE-5LB', 2270, 'BULK_5LB'::packaging_variant, 'LOVE_HOSPITAL', 'WHOLE_BEAN'::product_format, true),
    (v_old_id, 'Love Hospital 300g', 'OLD-LOVE-300G', 300, 'RETAIL_300G'::packaging_variant, 'LOVE_HOSPITAL', 'WHOLE_BEAN'::product_format, true),
    (v_old_id, 'Oldhand Decaf 300g', 'OLD-DECAF-300G', 300, 'RETAIL_300G'::packaging_variant, 'DECAF', 'WHOLE_BEAN'::product_format, true),
    (v_old_id, 'Oldhand Decaf 5lb', 'OLD-DECAF-5LB', 2270, 'BULK_5LB'::packaging_variant, 'DECAF', 'WHOLE_BEAN'::product_format, true)
  ON CONFLICT (sku) DO UPDATE SET
    product_name = EXCLUDED.product_name,
    bag_size_g = EXCLUDED.bag_size_g,
    packaging_variant = EXCLUDED.packaging_variant,
    roast_group = EXCLUDED.roast_group,
    is_active = true;

  -- ========== 4) UPSERT PRICES (placeholder $0 for all products) ==========
  INSERT INTO price_list (product_id, unit_price, effective_date, currency)
  SELECT p.id, 0.00, v_today, 'CAD'
  FROM products p
  WHERE NOT EXISTS (
    SELECT 1 FROM price_list pl WHERE pl.product_id = p.id
  );

  -- ========== 5) DELETE EXISTING SEEDED ORDERS ==========
  DELETE FROM ship_picks
  WHERE order_id IN (SELECT id FROM orders WHERE created_by_admin = true);

  DELETE FROM order_line_items
  WHERE order_id IN (SELECT id FROM orders WHERE created_by_admin = true);

  DELETE FROM orders WHERE created_by_admin = true;

  -- ========== 6) MATCHSTICK ORDER (~220kg target) ==========
  -- Catalogue: ~110kg (50%), Bulldog: ~66kg (30%), Decaf: ~22kg (10%)
  INSERT INTO orders (client_id, status, requested_ship_date, work_deadline, delivery_method, created_by_admin)
  VALUES (v_mat_id, 'CONFIRMED'::order_status, v_today, v_today, 'PICKUP'::delivery_method, true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  VALUES
    -- Catalogue 5lb: 60% of 110kg = 66kg = ~29 bags (29 × 2.27kg)
    (v_order_id, (SELECT id FROM products WHERE sku = 'MAT-CAT-5LB'), 29, 'WHOLE_BEAN'::grind_option, 0.00),
    -- Catalogue 340g: 40% of 110kg = 44kg = ~129 bags
    (v_order_id, (SELECT id FROM products WHERE sku = 'MAT-CAT-340G'), 129, 'WHOLE_BEAN'::grind_option, 0.00),
    -- Bulldog 5lb: 60% of 66kg = ~40kg = ~18 bags
    (v_order_id, (SELECT id FROM products WHERE sku = 'MAT-BULL-5LB'), 18, 'WHOLE_BEAN'::grind_option, 0.00),
    -- Bulldog 340g: 40% of 66kg = ~26kg = ~76 bags
    (v_order_id, (SELECT id FROM products WHERE sku = 'MAT-BULL-340G'), 76, 'WHOLE_BEAN'::grind_option, 0.00),
    -- Decaf 5lb: at least 1
    (v_order_id, (SELECT id FROM products WHERE sku = 'MAT-DECAF-5LB'), 2, 'WHOLE_BEAN'::grind_option, 0.00),
    -- Decaf 340g: remainder (~18kg = ~53 bags)
    (v_order_id, (SELECT id FROM products WHERE sku = 'MAT-DECAF-340G'), 48, 'WHOLE_BEAN'::grind_option, 0.00);

  -- ========== 7) FUNK ORDER ==========
  -- Technicolour: 50%, rest split evenly (Monochrome, Mellow, Decaf ~17% each)
  INSERT INTO orders (client_id, status, requested_ship_date, work_deadline, delivery_method, created_by_admin)
  VALUES (v_fun_id, 'CONFIRMED'::order_status, v_today, v_today, 'DELIVERY'::delivery_method, true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  VALUES
    -- Technicolour (50% of ~80kg = 40kg)
    (v_order_id, (SELECT id FROM products WHERE sku = 'FUN-TECH-5LB'), 8, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'FUN-TECH-2LB'), 12, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'FUN-TECH-250G'), 36, 'WHOLE_BEAN'::grind_option, 0.00),
    -- Monochrome (~13kg)
    (v_order_id, (SELECT id FROM products WHERE sku = 'FUN-MONO-5LB'), 3, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'FUN-MONO-2LB'), 4, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'FUN-MONO-250G'), 16, 'WHOLE_BEAN'::grind_option, 0.00),
    -- Mellow Carmello (~13kg)
    (v_order_id, (SELECT id FROM products WHERE sku = 'FUN-MELL-5LB'), 3, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'FUN-MELL-2LB'), 4, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'FUN-MELL-250G'), 16, 'WHOLE_BEAN'::grind_option, 0.00),
    -- Funk Decaf (~13kg)
    (v_order_id, (SELECT id FROM products WHERE sku = 'FUN-DECAF-5LB'), 2, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'FUN-DECAF-2LB'), 5, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'FUN-DECAF-250G'), 20, 'WHOLE_BEAN'::grind_option, 0.00);

  -- ========== 8) MAH ORDER ==========
  INSERT INTO orders (client_id, status, requested_ship_date, work_deadline, delivery_method, created_by_admin)
  VALUES (v_mah_id, 'CONFIRMED'::order_status, v_today, v_today, 'PICKUP'::delivery_method, true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  VALUES
    (v_order_id, (SELECT id FROM products WHERE sku = 'MAH-GUA-5LB'), 8, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'MAH-GUA-300G'), 12, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'MAH-BRAZIL-300G'), 12, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'MAH-BRAZIL-5LB'), 4, 'WHOLE_BEAN'::grind_option, 0.00);

  -- ========== 9) NO SMOKE ORDER (low volume) ==========
  INSERT INTO orders (client_id, status, requested_ship_date, work_deadline, delivery_method, created_by_admin)
  VALUES (v_nsm_id, 'CONFIRMED'::order_status, v_today, v_today, 'COURIER'::delivery_method, true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  VALUES
    (v_order_id, (SELECT id FROM products WHERE sku = 'NSM-HOUSE-340G'), 2, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'NSM-HOUSE-5LB'), 1, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'NSM-DECAF-340G'), 2, 'WHOLE_BEAN'::grind_option, 0.00);

  -- ========== 10) NELSON ORDER A (Soonest) ==========
  INSERT INTO orders (client_id, status, requested_ship_date, work_deadline, delivery_method, created_by_admin)
  VALUES (v_nel_id, 'CONFIRMED'::order_status, v_today, v_today, 'PICKUP'::delivery_method, true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  VALUES
    (v_order_id, (SELECT id FROM products WHERE sku = 'NEL-ETH-5LB'), 6, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'NEL-ETH-300G'), 10, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'NEL-RWA-5LB'), 1, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'NEL-RWA-300G'), 8, 'WHOLE_BEAN'::grind_option, 0.00);

  -- ========== 11) NELSON ORDER B (Next week) ==========
  INSERT INTO orders (client_id, status, requested_ship_date, work_deadline, delivery_method, created_by_admin)
  VALUES (v_nel_id, 'CONFIRMED'::order_status, v_next_week, v_next_week, 'DELIVERY'::delivery_method, true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  VALUES
    (v_order_id, (SELECT id FROM products WHERE sku = 'NEL-ETH-5LB'), 6, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'NEL-ETH-300G'), 12, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'NEL-RWA-5LB'), 1, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'NEL-RWA-300G'), 9, 'WHOLE_BEAN'::grind_option, 0.00);

  -- ========== 12) OLDHAND ORDER A (Location 1) ==========
  INSERT INTO orders (client_id, status, requested_ship_date, work_deadline, delivery_method, created_by_admin)
  VALUES (v_old_id, 'CONFIRMED'::order_status, v_today, v_today, 'PICKUP'::delivery_method, true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  VALUES
    (v_order_id, (SELECT id FROM products WHERE sku = 'OLD-LOVE-5LB'), 7, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'OLD-LOVE-300G'), 14, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'OLD-DECAF-300G'), 10, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'OLD-DECAF-5LB'), 2, 'WHOLE_BEAN'::grind_option, 0.00);

  -- ========== 13) OLDHAND ORDER B (Location 2) ==========
  INSERT INTO orders (client_id, status, requested_ship_date, work_deadline, delivery_method, created_by_admin)
  VALUES (v_old_id, 'CONFIRMED'::order_status, v_today, v_today, 'DELIVERY'::delivery_method, true)
  RETURNING id INTO v_order_id;
  
  INSERT INTO order_line_items (order_id, product_id, quantity_units, grind, unit_price_locked)
  VALUES
    (v_order_id, (SELECT id FROM products WHERE sku = 'OLD-LOVE-5LB'), 6, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'OLD-LOVE-300G'), 18, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'OLD-DECAF-300G'), 12, 'WHOLE_BEAN'::grind_option, 0.00),
    (v_order_id, (SELECT id FROM products WHERE sku = 'OLD-DECAF-5LB'), 1, 'WHOLE_BEAN'::grind_option, 0.00);

END;
$function$;