-- =====================================================
-- Fix: Prevent manipulation of order_notifications read_by array
-- Users should only be able to add themselves to the read_by array
-- =====================================================

-- Create a function to validate read_by array changes
CREATE OR REPLACE FUNCTION public.validate_read_by_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_read_by uuid[];
  v_new_read_by uuid[];
  v_added_users uuid[];
  v_removed_users uuid[];
  v_current_user uuid;
BEGIN
  v_current_user := auth.uid();
  v_old_read_by := COALESCE(OLD.read_by, ARRAY[]::uuid[]);
  v_new_read_by := COALESCE(NEW.read_by, ARRAY[]::uuid[]);
  
  -- Find users that were added (in new but not in old)
  v_added_users := ARRAY(
    SELECT unnest(v_new_read_by) 
    EXCEPT 
    SELECT unnest(v_old_read_by)
  );
  
  -- Find users that were removed (in old but not in new)
  v_removed_users := ARRAY(
    SELECT unnest(v_old_read_by) 
    EXCEPT 
    SELECT unnest(v_new_read_by)
  );
  
  -- Validate: Users can only add themselves to read_by
  IF array_length(v_added_users, 1) > 0 THEN
    -- Check that only the current user is being added
    IF array_length(v_added_users, 1) > 1 OR v_added_users[1] != v_current_user THEN
      RAISE EXCEPTION 'You can only mark notifications as read for yourself';
    END IF;
  END IF;
  
  -- Validate: Users cannot remove other users from read_by (can only remove themselves)
  IF array_length(v_removed_users, 1) > 0 THEN
    -- Check that only the current user is being removed (if any)
    IF array_length(v_removed_users, 1) > 1 THEN
      RAISE EXCEPTION 'You can only modify your own read status';
    END IF;
    IF v_removed_users[1] != v_current_user THEN
      RAISE EXCEPTION 'You cannot unmark notifications as read for other users';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to validate read_by changes
DROP TRIGGER IF EXISTS validate_read_by_trigger ON public.order_notifications;

CREATE TRIGGER validate_read_by_trigger
  BEFORE UPDATE OF read_by ON public.order_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_read_by_update();