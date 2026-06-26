-- Breadcrumb table for tracing shopify-oauth-callback runs. Platform/function
-- logs are dead, so the callback INSERTs a row at each major step. Read with SQL
-- to trace an install attempt end-to-end.
create table if not exists public.shopify_oauth_debug (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  shop text,
  step text,
  detail text
);

create index if not exists shopify_oauth_debug_created_at_idx
  on public.shopify_oauth_debug (created_at desc);
