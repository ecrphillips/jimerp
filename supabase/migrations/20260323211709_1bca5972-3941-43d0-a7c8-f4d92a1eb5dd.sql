ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS account_code text;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_account_code_unique ON public.accounts (account_code) WHERE account_code IS NOT NULL;