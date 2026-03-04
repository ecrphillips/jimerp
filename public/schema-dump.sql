-- ============================================================
-- SCHEMA DUMP (no data) — public schema
-- Generated: 2026-03-04
-- ============================================================

-- =========================
-- EXTENSIONS
-- =========================
CREATE EXTENSION IF NOT EXISTS citext;

-- =========================
-- ENUMS
-- =========================
CREATE TYPE public.app_role AS ENUM ('ADMIN', 'OPS', 'CLIENT');
CREATE TYPE public.board_source AS ENUM ('MATCHSTICK', 'FUNK', 'NOSMOKE');
CREATE TYPE public.default_roaster AS ENUM ('SAMIAC', 'LORING', 'EITHER');
CREATE TYPE public.delivery_method AS ENUM ('PICKUP', 'DELIVERY', 'COURIER');
CREATE TYPE public.exception_event_type AS ENUM ('DESTONER_SPILL', 'BIN_MIX_SAME', 'BIN_MIX_DIFFERENT', 'WIP_ADJUSTMENT', 'DECONSTRUCT', 'OTHER');
CREATE TYPE public.grind_option AS ENUM ('WHOLE_BEAN', 'ESPRESSO', 'FILTER');
CREATE TYPE public.inventory_transaction_type AS ENUM ('ROAST_OUTPUT', 'PACK_CONSUME_WIP', 'PACK_PRODUCE_FG', 'SHIP_CONSUME_FG', 'ADJUSTMENT', 'LOSS');
CREATE TYPE public.order_status AS ENUM ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'SHIPPED', 'CANCELLED');
CREATE TYPE public.packaging_variant AS ENUM ('RETAIL_250G', 'RETAIL_300G', 'RETAIL_340G', 'RETAIL_454G', 'CROWLER_200G', 'CROWLER_250G', 'CAN_125G', 'BULK_2LB', 'BULK_1KG', 'BULK_5LB', 'BULK_2KG');
CREATE TYPE public.product_format AS ENUM ('WHOLE_BEAN', 'ESPRESSO', 'FILTER', 'OTHER');
CREATE TYPE public.production_status AS ENUM ('PLANNED', 'ROASTED', 'PACKED', 'STAGED', 'COMPLETE');
CREATE TYPE public.roasted_batch_status AS ENUM ('PLANNED', 'ROASTED');
CREATE TYPE public.roaster_machine AS ENUM ('SAMIAC', 'LORING');
CREATE TYPE public.ship_priority AS ENUM ('NORMAL', 'TIME_SENSITIVE');
CREATE TYPE public.wip_adjustment_reason AS ENUM ('LOSS', 'COUNT_ADJUSTMENT', 'CONTAMINATION', 'OTHER');
CREATE TYPE public.wip_entry_type AS ENUM ('ROAST_OUTPUT', 'PACK_CONSUME', 'LOSS', 'ADJUSTMENT', 'REALLOCATE_IN', 'REALLOCATE_OUT', 'DECONSTRUCT_IN', 'DECONSTRUCT_OUT');

-- =========================
-- SEQUENCES
-- =========================
CREATE SEQUENCE public.order_number_seq;

-- =========================
-- TABLES
-- =========================

CREATE TABLE public.clients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  billing_contact_name text,
  billing_email text,
  shipping_address text,
  notes_internal text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  client_code text NOT NULL,
  case_only boolean NOT NULL DEFAULT false,
  case_size integer
);

CREATE TABLE public.client_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  name text NOT NULL,
  location_code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role app_role NOT NULL,
  client_id uuid
);

CREATE TABLE public.packaging_types (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.roast_groups (
  roast_group text NOT NULL,
  standard_batch_kg numeric NOT NULL DEFAULT 20,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  default_roaster default_roaster NOT NULL DEFAULT 'EITHER'::default_roaster,
  expected_yield_loss_pct numeric NOT NULL DEFAULT 16.0,
  display_order integer,
  roast_group_code text NOT NULL,
  is_blend boolean NOT NULL DEFAULT false,
  origin text,
  blend_name text,
  display_name citext NOT NULL,
  cropster_profile_ref text
);

CREATE TABLE public.roast_group_components (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  parent_roast_group text NOT NULL,
  component_roast_group text NOT NULL,
  pct numeric NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.roast_group_inventory_levels (
  roast_group text NOT NULL,
  wip_kg numeric NOT NULL DEFAULT 0,
  fg_kg numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  product_name text NOT NULL,
  sku text,
  format product_format NOT NULL DEFAULT 'OTHER'::product_format,
  bag_size_g integer NOT NULL,
  grind_options grind_option[] DEFAULT '{}'::grind_option[],
  is_active boolean NOT NULL DEFAULT true,
  internal_packaging_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  packaging_variant packaging_variant,
  is_perennial boolean NOT NULL DEFAULT false,
  roast_group text,
  pack_display_order integer,
  packaging_type_id uuid,
  grams_per_unit integer
);

CREATE TABLE public.price_list (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  unit_price numeric NOT NULL,
  currency text NOT NULL DEFAULT 'CAD'::text,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.green_coffee_lots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  supplier text,
  origin text,
  received_date date,
  kg_received numeric NOT NULL DEFAULT 0,
  kg_on_hand numeric NOT NULL DEFAULT 0,
  notes_internal text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  order_number text NOT NULL,
  status order_status NOT NULL DEFAULT 'DRAFT'::order_status,
  requested_ship_date date,
  delivery_method delivery_method NOT NULL DEFAULT 'PICKUP'::delivery_method,
  client_po text,
  created_by_user_id uuid,
  internal_ops_notes text,
  client_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  roasted boolean NOT NULL DEFAULT false,
  packed boolean NOT NULL DEFAULT false,
  shipped_or_ready boolean NOT NULL DEFAULT false,
  invoiced boolean NOT NULL DEFAULT false,
  created_by_admin boolean NOT NULL DEFAULT false,
  ship_display_order integer,
  manually_deprioritized boolean NOT NULL DEFAULT false,
  work_deadline date,
  location_id uuid,
  work_deadline_at timestamptz,
  notify_email_sent_at timestamptz,
  notify_email_error text
);

CREATE TABLE public.order_line_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity_units integer NOT NULL,
  grind grind_option,
  unit_price_locked numeric NOT NULL,
  line_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.order_date_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  field_name text NOT NULL,
  old_value date,
  new_value date,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE TABLE public.order_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  client_name text NOT NULL,
  order_number text NOT NULL,
  work_deadline text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_by uuid[] DEFAULT '{}'::uuid[]
);

CREATE TABLE public.roasted_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  roast_group text NOT NULL,
  target_date date NOT NULL,
  planned_output_kg numeric,
  actual_output_kg numeric NOT NULL DEFAULT 0,
  status roasted_batch_status NOT NULL DEFAULT 'PLANNED'::roasted_batch_status,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  assigned_roaster roaster_machine,
  cropster_batch_id text,
  planned_for_blend_roast_group text,
  consumed_by_blend_at timestamptz
);

CREATE TABLE public.roast_exception_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  target_date date NOT NULL,
  roast_group text NOT NULL,
  batch_id uuid,
  event_type exception_event_type NOT NULL,
  delta_wip_kg numeric NOT NULL DEFAULT 0,
  delta_output_kg numeric NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT ''::text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.packing_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  target_date date NOT NULL,
  units_packed integer NOT NULL DEFAULT 0,
  kg_consumed numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE public.production_plan_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_date date NOT NULL,
  order_id uuid NOT NULL,
  client_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity_units integer NOT NULL,
  status production_status NOT NULL DEFAULT 'PLANNED'::production_status,
  ops_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.production_checkmarks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_date date NOT NULL,
  product_id uuid NOT NULL,
  bag_size_g integer NOT NULL,
  roast_complete boolean NOT NULL DEFAULT false,
  pack_complete boolean NOT NULL DEFAULT false,
  ship_complete boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  ship_priority ship_priority NOT NULL DEFAULT 'NORMAL'::ship_priority
);

CREATE TABLE public.ship_picks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  order_line_item_id uuid NOT NULL,
  units_picked integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE public.inventory_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  transaction_type inventory_transaction_type NOT NULL,
  roast_group text,
  product_id uuid,
  order_id uuid,
  quantity_kg numeric,
  quantity_units integer,
  notes text,
  is_system_generated boolean NOT NULL DEFAULT false
);

CREATE TABLE public.fg_inventory (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  units_on_hand integer NOT NULL DEFAULT 0,
  notes text DEFAULT ''::text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE public.fg_inventory_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  units_delta integer NOT NULL,
  units_after integer NOT NULL,
  notes text DEFAULT ''::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.wip_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  target_date date NOT NULL,
  roast_group text NOT NULL,
  entry_type wip_entry_type NOT NULL,
  delta_kg numeric NOT NULL,
  related_batch_id uuid,
  related_product_id uuid,
  notes text NOT NULL DEFAULT ''::text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.wip_adjustments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  roast_group text NOT NULL,
  kg_delta numeric NOT NULL,
  reason wip_adjustment_reason NOT NULL,
  notes text DEFAULT ''::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.andon_picks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  board text NOT NULL,
  product_id uuid NOT NULL,
  target_date date NOT NULL,
  units_picked integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  units_supplied integer NOT NULL DEFAULT 0
);

CREATE TABLE public.external_demand (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source board_source NOT NULL,
  target_date date NOT NULL,
  product_id uuid NOT NULL,
  quantity_units integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE public.source_board_products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source board_source NOT NULL,
  product_id uuid NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.app_settings (
  key text NOT NULL,
  value_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE public.client_allowed_products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  product_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- PRIMARY KEYS
-- =========================
ALTER TABLE public.clients ADD CONSTRAINT clients_pkey PRIMARY KEY (id);
ALTER TABLE public.client_locations ADD CONSTRAINT client_locations_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
ALTER TABLE public.packaging_types ADD CONSTRAINT packaging_types_pkey PRIMARY KEY (id);
ALTER TABLE public.roast_groups ADD CONSTRAINT roast_groups_pkey PRIMARY KEY (roast_group);
ALTER TABLE public.roast_group_components ADD CONSTRAINT roast_group_components_pkey PRIMARY KEY (id);
ALTER TABLE public.roast_group_inventory_levels ADD CONSTRAINT roast_group_inventory_levels_pkey PRIMARY KEY (roast_group);
ALTER TABLE public.products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
ALTER TABLE public.price_list ADD CONSTRAINT price_list_pkey PRIMARY KEY (id);
ALTER TABLE public.green_coffee_lots ADD CONSTRAINT green_coffee_lots_pkey PRIMARY KEY (id);
ALTER TABLE public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE public.order_line_items ADD CONSTRAINT order_line_items_pkey PRIMARY KEY (id);
ALTER TABLE public.order_date_audit_log ADD CONSTRAINT order_date_audit_log_pkey PRIMARY KEY (id);
ALTER TABLE public.order_notifications ADD CONSTRAINT order_notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.roasted_batches ADD CONSTRAINT roasted_batches_pkey PRIMARY KEY (id);
ALTER TABLE public.roast_exception_events ADD CONSTRAINT roast_exception_events_pkey PRIMARY KEY (id);
ALTER TABLE public.packing_runs ADD CONSTRAINT packing_runs_pkey PRIMARY KEY (id);
ALTER TABLE public.production_plan_items ADD CONSTRAINT production_plan_items_pkey PRIMARY KEY (id);
ALTER TABLE public.production_checkmarks ADD CONSTRAINT production_checkmarks_pkey PRIMARY KEY (id);
ALTER TABLE public.ship_picks ADD CONSTRAINT ship_picks_pkey PRIMARY KEY (id);
ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_pkey PRIMARY KEY (id);
ALTER TABLE public.fg_inventory ADD CONSTRAINT fg_inventory_pkey PRIMARY KEY (id);
ALTER TABLE public.fg_inventory_log ADD CONSTRAINT fg_inventory_log_pkey PRIMARY KEY (id);
ALTER TABLE public.wip_ledger ADD CONSTRAINT wip_ledger_pkey PRIMARY KEY (id);
ALTER TABLE public.wip_adjustments ADD CONSTRAINT wip_adjustments_pkey PRIMARY KEY (id);
ALTER TABLE public.andon_picks ADD CONSTRAINT andon_picks_pkey PRIMARY KEY (id);
ALTER TABLE public.external_demand ADD CONSTRAINT external_demand_pkey PRIMARY KEY (id);
ALTER TABLE public.source_board_products ADD CONSTRAINT source_board_products_pkey PRIMARY KEY (id);
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);
ALTER TABLE public.client_allowed_products ADD CONSTRAINT client_allowed_products_pkey PRIMARY KEY (id);

-- =========================
-- UNIQUE CONSTRAINTS
-- =========================
ALTER TABLE public.clients ADD CONSTRAINT clients_client_code_key UNIQUE (client_code);
ALTER TABLE public.client_locations ADD CONSTRAINT client_locations_client_code_unique UNIQUE (client_id, location_code);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
ALTER TABLE public.packaging_types ADD CONSTRAINT packaging_types_name_key UNIQUE (name);
ALTER TABLE public.roast_groups ADD CONSTRAINT roast_groups_display_name_unique UNIQUE (display_name);
ALTER TABLE public.roast_groups ADD CONSTRAINT roast_groups_code_unique UNIQUE (roast_group_code);
ALTER TABLE public.roast_group_components ADD CONSTRAINT roast_group_components_parent_roast_group_component_roast_g_key UNIQUE (parent_roast_group, component_roast_group);
ALTER TABLE public.products ADD CONSTRAINT products_sku_key UNIQUE (sku);
ALTER TABLE public.orders ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);
ALTER TABLE public.packing_runs ADD CONSTRAINT packing_runs_product_id_target_date_key UNIQUE (product_id, target_date);
ALTER TABLE public.production_checkmarks ADD CONSTRAINT production_checkmarks_target_date_product_id_bag_size_g_key UNIQUE (target_date, product_id, bag_size_g);
ALTER TABLE public.ship_picks ADD CONSTRAINT ship_picks_order_line_item_unique UNIQUE (order_line_item_id);
ALTER TABLE public.fg_inventory ADD CONSTRAINT fg_inventory_product_id_key UNIQUE (product_id);
ALTER TABLE public.andon_picks ADD CONSTRAINT andon_picks_board_product_id_target_date_key UNIQUE (board, product_id, target_date);
ALTER TABLE public.external_demand ADD CONSTRAINT external_demand_source_target_date_product_id_key UNIQUE (source, target_date, product_id);
ALTER TABLE public.source_board_products ADD CONSTRAINT source_board_products_source_product_id_key UNIQUE (source, product_id);
ALTER TABLE public.client_allowed_products ADD CONSTRAINT client_allowed_products_client_id_product_id_key UNIQUE (client_id, product_id);

-- =========================
-- FOREIGN KEYS
-- =========================
ALTER TABLE public.client_locations ADD CONSTRAINT client_locations_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE public.roast_group_components ADD CONSTRAINT roast_group_components_parent_roast_group_fkey FOREIGN KEY (parent_roast_group) REFERENCES roast_groups(roast_group) ON DELETE CASCADE;
ALTER TABLE public.roast_group_components ADD CONSTRAINT roast_group_components_component_roast_group_fkey FOREIGN KEY (component_roast_group) REFERENCES roast_groups(roast_group) ON DELETE RESTRICT;
ALTER TABLE public.roast_group_inventory_levels ADD CONSTRAINT roast_group_inventory_levels_roast_group_fkey FOREIGN KEY (roast_group) REFERENCES roast_groups(roast_group) ON DELETE CASCADE;
ALTER TABLE public.roast_group_inventory_levels ADD CONSTRAINT roast_group_inventory_levels_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public.products ADD CONSTRAINT products_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE public.products ADD CONSTRAINT products_packaging_type_id_fkey FOREIGN KEY (packaging_type_id) REFERENCES packaging_types(id);
ALTER TABLE public.price_list ADD CONSTRAINT price_list_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD CONSTRAINT orders_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD CONSTRAINT orders_location_id_fkey FOREIGN KEY (location_id) REFERENCES client_locations(id);
ALTER TABLE public.orders ADD CONSTRAINT orders_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id);
ALTER TABLE public.order_line_items ADD CONSTRAINT order_line_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE public.order_line_items ADD CONSTRAINT order_line_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.order_date_audit_log ADD CONSTRAINT order_date_audit_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE public.order_date_audit_log ADD CONSTRAINT order_date_audit_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id);
ALTER TABLE public.order_notifications ADD CONSTRAINT order_notifications_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE public.roasted_batches ADD CONSTRAINT roasted_batches_planned_for_blend_roast_group_fkey FOREIGN KEY (planned_for_blend_roast_group) REFERENCES roast_groups(roast_group) ON DELETE SET NULL;
ALTER TABLE public.roasted_batches ADD CONSTRAINT roasted_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.roast_exception_events ADD CONSTRAINT roast_exception_events_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES roasted_batches(id) ON DELETE SET NULL;
ALTER TABLE public.roast_exception_events ADD CONSTRAINT roast_exception_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.packing_runs ADD CONSTRAINT packing_runs_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.packing_runs ADD CONSTRAINT packing_runs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public.production_plan_items ADD CONSTRAINT production_plan_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE public.production_plan_items ADD CONSTRAINT production_plan_items_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);
ALTER TABLE public.production_plan_items ADD CONSTRAINT production_plan_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.production_checkmarks ADD CONSTRAINT production_checkmarks_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.production_checkmarks ADD CONSTRAINT production_checkmarks_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public.ship_picks ADD CONSTRAINT ship_picks_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE public.ship_picks ADD CONSTRAINT ship_picks_order_line_item_id_fkey FOREIGN KEY (order_line_item_id) REFERENCES order_line_items(id) ON DELETE CASCADE;
ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);
ALTER TABLE public.fg_inventory ADD CONSTRAINT fg_inventory_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.fg_inventory ADD CONSTRAINT fg_inventory_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public.fg_inventory_log ADD CONSTRAINT fg_inventory_log_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.fg_inventory_log ADD CONSTRAINT fg_inventory_log_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.wip_ledger ADD CONSTRAINT wip_ledger_related_batch_id_fkey FOREIGN KEY (related_batch_id) REFERENCES roasted_batches(id) ON DELETE SET NULL;
ALTER TABLE public.wip_ledger ADD CONSTRAINT wip_ledger_related_product_id_fkey FOREIGN KEY (related_product_id) REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE public.wip_ledger ADD CONSTRAINT wip_ledger_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.wip_adjustments ADD CONSTRAINT wip_adjustments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.andon_picks ADD CONSTRAINT andon_picks_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.andon_picks ADD CONSTRAINT andon_picks_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public.external_demand ADD CONSTRAINT external_demand_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.external_demand ADD CONSTRAINT external_demand_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public.source_board_products ADD CONSTRAINT source_board_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.client_allowed_products ADD CONSTRAINT client_allowed_products_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE public.client_allowed_products ADD CONSTRAINT client_allowed_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

-- =========================
-- INDEXES
-- =========================
CREATE INDEX idx_client_locations_client_id ON public.client_locations USING btree (client_id);
CREATE INDEX idx_inventory_transactions_created_at ON public.inventory_transactions USING btree (created_at DESC);
CREATE INDEX idx_inventory_transactions_product_id ON public.inventory_transactions USING btree (product_id) WHERE (product_id IS NOT NULL);
CREATE INDEX idx_inventory_transactions_roast_group ON public.inventory_transactions USING btree (roast_group) WHERE (roast_group IS NOT NULL);
CREATE INDEX idx_inventory_transactions_type ON public.inventory_transactions USING btree (transaction_type);
CREATE INDEX idx_order_date_audit_log_changed_at ON public.order_date_audit_log USING btree (changed_at DESC);
CREATE INDEX idx_order_date_audit_log_order_id ON public.order_date_audit_log USING btree (order_id);
CREATE INDEX idx_order_line_items_order_id ON public.order_line_items USING btree (order_id);
CREATE INDEX idx_order_notifications_created_at ON public.order_notifications USING btree (created_at DESC);
CREATE INDEX idx_orders_client_id ON public.orders USING btree (client_id);
CREATE INDEX idx_orders_location_id ON public.orders USING btree (location_id);
CREATE INDEX idx_orders_status ON public.orders USING btree (status);
CREATE INDEX orders_work_deadline_at_idx ON public.orders USING btree (work_deadline_at);
CREATE INDEX idx_price_list_product_id ON public.price_list USING btree (product_id);
CREATE INDEX idx_production_plan_items_status ON public.production_plan_items USING btree (status);
CREATE INDEX idx_production_plan_items_target_date ON public.production_plan_items USING btree (target_date);
CREATE INDEX idx_products_client_id ON public.products USING btree (client_id);
CREATE UNIQUE INDEX products_sku_unique_ci ON public.products USING btree (upper(TRIM(BOTH FROM sku))) WHERE (sku IS NOT NULL);
CREATE INDEX idx_roast_exception_events_batch ON public.roast_exception_events USING btree (batch_id);
CREATE INDEX idx_roast_exception_events_date ON public.roast_exception_events USING btree (target_date);
CREATE INDEX idx_roast_group_components_parent ON public.roast_group_components USING btree (parent_roast_group);
CREATE INDEX idx_roast_groups_code ON public.roast_groups USING btree (roast_group_code);
CREATE INDEX idx_roasted_batches_blend_parent ON public.roasted_batches USING btree (planned_for_blend_roast_group) WHERE (planned_for_blend_roast_group IS NOT NULL);
CREATE INDEX idx_roasted_batches_unconsumed ON public.roasted_batches USING btree (roast_group, status) WHERE (consumed_by_blend_at IS NULL);
CREATE INDEX idx_ship_picks_order_id ON public.ship_picks USING btree (order_id);
CREATE INDEX idx_ship_picks_order_line_item_id ON public.ship_picks USING btree (order_line_item_id);
CREATE INDEX idx_user_roles_client_id ON public.user_roles USING btree (client_id);
CREATE INDEX idx_user_roles_user_id ON public.user_roles USING btree (user_id);
CREATE INDEX idx_wip_ledger_related_batch ON public.wip_ledger USING btree (related_batch_id);
CREATE INDEX idx_wip_ledger_related_product ON public.wip_ledger USING btree (related_product_id);
CREATE INDEX idx_wip_ledger_roast_group_date ON public.wip_ledger USING btree (roast_group, target_date);
