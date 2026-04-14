
ALTER TABLE coroast_recurring_blocks ALTER COLUMN member_id DROP NOT NULL;
ALTER TABLE coroast_recurring_blocks DROP CONSTRAINT IF EXISTS coroast_recurring_blocks_member_id_fkey;

ALTER TABLE coroast_storage_allocations ALTER COLUMN member_id DROP NOT NULL;
ALTER TABLE coroast_storage_allocations DROP CONSTRAINT IF EXISTS coroast_storage_allocations_member_id_fkey;

ALTER TABLE coroast_waiver_log ALTER COLUMN member_id DROP NOT NULL;
ALTER TABLE coroast_waiver_log DROP CONSTRAINT IF EXISTS coroast_waiver_log_member_id_fkey;

ALTER TABLE coroast_invoices ALTER COLUMN member_id DROP NOT NULL;
ALTER TABLE coroast_invoices DROP CONSTRAINT IF EXISTS coroast_invoices_member_id_fkey;
