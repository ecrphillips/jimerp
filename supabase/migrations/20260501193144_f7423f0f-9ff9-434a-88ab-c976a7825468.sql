CREATE POLICY "Users can read their own account_users row"
  ON public.account_users
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());