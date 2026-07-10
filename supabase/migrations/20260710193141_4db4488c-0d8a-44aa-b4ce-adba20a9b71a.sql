
DROP POLICY IF EXISTS "Deny anonymous access to green_purchase_lines" ON public.green_purchase_lines;
CREATE POLICY "Deny anonymous access to green_purchase_lines"
  ON public.green_purchase_lines
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Deny anonymous access to green_release_lines" ON public.green_release_lines;
CREATE POLICY "Deny anonymous access to green_release_lines"
  ON public.green_release_lines
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);
