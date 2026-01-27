-- Add work_deadline field to orders table
ALTER TABLE public.orders 
ADD COLUMN work_deadline date;

-- Add comment explaining the field
COMMENT ON COLUMN public.orders.work_deadline IS 'Internal deadline: the latest moment order must be staged and ready. Used for all production prioritization.';

-- Create audit log table for order date changes
CREATE TABLE public.order_date_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  field_name text NOT NULL CHECK (field_name IN ('requested_ship_date', 'work_deadline')),
  old_value date,
  new_value date,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

-- Create index for efficient lookups by order
CREATE INDEX idx_order_date_audit_log_order_id ON public.order_date_audit_log(order_id);
CREATE INDEX idx_order_date_audit_log_changed_at ON public.order_date_audit_log(changed_at DESC);

-- Enable RLS
ALTER TABLE public.order_date_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS policy: Admin/Ops can manage audit log
CREATE POLICY "Admin/Ops can manage order date audit log"
ON public.order_date_audit_log
FOR ALL
USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Create trigger function to auto-log date changes
CREATE OR REPLACE FUNCTION public.log_order_date_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Log requested_ship_date changes
  IF OLD.requested_ship_date IS DISTINCT FROM NEW.requested_ship_date THEN
    INSERT INTO public.order_date_audit_log (order_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, 'requested_ship_date', OLD.requested_ship_date, NEW.requested_ship_date, auth.uid());
  END IF;
  
  -- Log work_deadline changes
  IF OLD.work_deadline IS DISTINCT FROM NEW.work_deadline THEN
    INSERT INTO public.order_date_audit_log (order_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, 'work_deadline', OLD.work_deadline, NEW.work_deadline, auth.uid());
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on orders table
CREATE TRIGGER trigger_log_order_date_changes
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.log_order_date_changes();