-- Create table for order notifications
CREATE TABLE public.order_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  order_number TEXT NOT NULL,
  work_deadline TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  read_by UUID[] DEFAULT '{}'::UUID[]
);

-- Enable RLS
ALTER TABLE public.order_notifications ENABLE ROW LEVEL SECURITY;

-- OPS and ADMIN can read all notifications
CREATE POLICY "OPS and ADMIN can view notifications"
  ON public.order_notifications
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'ADMIN'::app_role) OR public.has_role(auth.uid(), 'OPS'::app_role)
  );

-- OPS and ADMIN can update (mark as read)
CREATE POLICY "OPS and ADMIN can update notifications"
  ON public.order_notifications
  FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'ADMIN'::app_role) OR public.has_role(auth.uid(), 'OPS'::app_role)
  );

-- System can insert (via service role)
CREATE POLICY "System can insert notifications"
  ON public.order_notifications
  FOR INSERT
  WITH CHECK (true);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_notifications;

-- Create index for faster queries
CREATE INDEX idx_order_notifications_created_at ON public.order_notifications(created_at DESC);