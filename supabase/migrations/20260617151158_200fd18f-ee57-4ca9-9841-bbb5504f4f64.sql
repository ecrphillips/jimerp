-- FUNK CSV Importer (Build 1): schema foundation

create table if not exists public.funk_import_product_mappings (
  id uuid primary key default gen_random_uuid(),
  csv_sku text,
  csv_product_name text not null,
  product_id uuid references public.products(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid()
);

grant select, insert, update, delete on public.funk_import_product_mappings to authenticated;
grant all on public.funk_import_product_mappings to service_role;

create unique index if not exists funk_map_sku_uniq
  on public.funk_import_product_mappings (csv_sku) where csv_sku is not null;
create unique index if not exists funk_map_name_uniq
  on public.funk_import_product_mappings (csv_product_name) where csv_sku is null;

create table if not exists public.funk_import_sessions (
  id uuid primary key default gen_random_uuid(),
  file_name text,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id) default auth.uid(),
  orders_new integer not null default 0,
  orders_skipped integer not null default 0,
  bundle_order_id uuid references public.orders(id) on delete set null
);

grant select, insert, update, delete on public.funk_import_sessions to authenticated;
grant all on public.funk_import_sessions to service_role;

create table if not exists public.funk_imported_orders (
  id uuid primary key default gen_random_uuid(),
  shopify_order_name text not null unique,
  shopify_order_id text,
  import_session_id uuid references public.funk_import_sessions(id) on delete set null,
  destination text not null default 'ship_now',
  imported_at timestamptz not null default now()
);

grant select, insert, update, delete on public.funk_imported_orders to authenticated;
grant all on public.funk_imported_orders to service_role;

alter table public.products
  add column if not exists is_placeholder boolean not null default false;

create or replace function public.touch_funk_import_mappings()
returns trigger language plpgsql
set search_path = public
as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_touch_funk_import_mappings on public.funk_import_product_mappings;
create trigger trg_touch_funk_import_mappings
  before update on public.funk_import_product_mappings
  for each row execute function public.touch_funk_import_mappings();

alter table public.funk_import_product_mappings enable row level security;
alter table public.funk_import_sessions enable row level security;
alter table public.funk_imported_orders enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'funk_import_product_mappings','funk_import_sessions','funk_imported_orders'
  ] loop
    execute format('drop policy if exists "admin_ops_manage" on public.%I;', t);
    execute format(
      'create policy "admin_ops_manage" on public.%I for all to authenticated
         using (public.has_role(auth.uid(), ''ADMIN''::app_role) or public.has_role(auth.uid(), ''OPS''::app_role))
         with check (public.has_role(auth.uid(), ''ADMIN''::app_role) or public.has_role(auth.uid(), ''OPS''::app_role));', t);
    execute format('drop policy if exists "deny_anon" on public.%I;', t);
    execute format('create policy "deny_anon" on public.%I for all to anon using (false) with check (false);', t);
  end loop;
end $$;

notify pgrst, 'reload schema';