-- FUNK CSV Importer (Build 2): DROP batch engine schema

create table if not exists public.funk_drop_batches (
  id uuid primary key default gen_random_uuid(),
  batch_year integer not null,
  batch_month integer not null,
  ship_date date not null,
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (batch_year, batch_month)
);

create table if not exists public.funk_drop_slots (
  id uuid primary key default gen_random_uuid(),
  batch_year integer not null,
  batch_month integer not null,
  slot_number integer not null check (slot_number in (1,2)),
  product_id uuid references public.products(id) on delete set null,
  sourced_green_ref uuid,
  created_at timestamptz not null default now(),
  unique (batch_year, batch_month, slot_number)
);

grant select, insert, update, delete on public.funk_drop_batches to authenticated;
grant all on public.funk_drop_batches to service_role;
grant select, insert, update, delete on public.funk_drop_slots to authenticated;
grant all on public.funk_drop_slots to service_role;

alter table public.funk_drop_batches enable row level security;
alter table public.funk_drop_slots enable row level security;

do $$
declare t text;
begin
  foreach t in array array['funk_drop_batches','funk_drop_slots'] loop
    execute format('drop policy if exists "admin_ops_manage" on public.%I;', t);
    execute format(
      'create policy "admin_ops_manage" on public.%I for all to authenticated
         using (public.has_role(auth.uid(), ''ADMIN'') or public.has_role(auth.uid(), ''OPS''))
         with check (public.has_role(auth.uid(), ''ADMIN'') or public.has_role(auth.uid(), ''OPS''));', t);
    execute format('drop policy if exists "deny_anon" on public.%I;', t);
    execute format('create policy "deny_anon" on public.%I for all to anon using (false) with check (false);', t);
  end loop;
end $$;

notify pgrst, 'reload schema';