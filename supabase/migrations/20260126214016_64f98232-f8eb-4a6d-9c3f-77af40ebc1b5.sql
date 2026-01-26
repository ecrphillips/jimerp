-- Create ship_picks table for per-order-line-item picking tracking
CREATE TABLE public.ship_picks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_line_item_id UUID NOT NULL REFERENCES public.order_line_items(id) ON DELETE CASCADE,
  units_picked INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID,
  CONSTRAINT ship_picks_order_line_item_unique UNIQUE (order_line_item_id)
);

-- Enable RLS
ALTER TABLE public.ship_picks ENABLE ROW LEVEL SECURITY;

-- Create policy for Admin/Ops
CREATE POLICY "Admin/Ops can manage ship picks"
ON public.ship_picks
FOR ALL
USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Create index for performance
CREATE INDEX idx_ship_picks_order_id ON public.ship_picks(order_id);
CREATE INDEX idx_ship_picks_order_line_item_id ON public.ship_picks(order_line_item_id);

-- Add trigger for updated_at
CREATE TRIGGER handle_ship_picks_updated_at
  BEFORE UPDATE ON public.ship_picks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();