-- Create andon_picks table for tracking partial picking into totes
CREATE TABLE public.andon_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board text NOT NULL CHECK (board IN ('MATCHSTICK', 'FUNK')),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  target_date date NOT NULL,
  units_picked integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  UNIQUE (board, product_id, target_date)
);

-- Enable RLS
ALTER TABLE public.andon_picks ENABLE ROW LEVEL SECURITY;

-- Admin/Ops can manage all rows
CREATE POLICY "Admin/Ops can manage andon picks"
ON public.andon_picks
FOR ALL
USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Add trigger for updated_at
CREATE TRIGGER update_andon_picks_updated_at
BEFORE UPDATE ON public.andon_picks
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();