
-- Create a helper function to call nextval from the client
CREATE OR REPLACE FUNCTION public.nextval_text(seq_name text)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nextval(seq_name::regclass);
$$;
