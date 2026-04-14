
ALTER TABLE coroast_billing_periods ALTER COLUMN member_id DROP NOT NULL;
ALTER TABLE coroast_billing_periods DROP CONSTRAINT IF EXISTS coroast_billing_periods_member_id_fkey;

ALTER TABLE coroast_bookings ALTER COLUMN member_id DROP NOT NULL;
ALTER TABLE coroast_bookings DROP CONSTRAINT IF EXISTS coroast_bookings_member_id_fkey;

ALTER TABLE coroast_hour_ledger ALTER COLUMN member_id DROP NOT NULL;
ALTER TABLE coroast_hour_ledger DROP CONSTRAINT IF EXISTS coroast_hour_ledger_member_id_fkey;
