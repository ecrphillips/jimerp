-- Step 6: Drop get_user_client_id() after all dependent policies have been replaced.
-- Will fail cleanly if any policy or function still references it.

DROP FUNCTION public.get_user_client_id(uuid);
