ALTER TABLE public.coroast_member_checklist
  ADD COLUMN qbo_company_name boolean NOT NULL DEFAULT false,
  ADD COLUMN qbo_billing_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN qbo_billing_address boolean NOT NULL DEFAULT false,
  ADD COLUMN qbo_credit_card boolean NOT NULL DEFAULT false;