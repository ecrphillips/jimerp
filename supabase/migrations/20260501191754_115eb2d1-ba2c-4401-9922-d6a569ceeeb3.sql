UPDATE public.account_users
SET can_place_orders = false,
    updated_at = now()
WHERE id IN (
  '22220dba-f21b-4558-8ff8-511289101291',
  'ae9e2379-bc0f-40c0-bf06-0874ba25f423'
);