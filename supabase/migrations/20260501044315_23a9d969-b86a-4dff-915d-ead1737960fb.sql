-- packaging_costs: split cost_per_unit into material + labour
ALTER TABLE public.packaging_costs
  RENAME COLUMN cost_per_unit TO material_cost_per_unit;

ALTER TABLE public.packaging_costs
  ADD COLUMN labour_cost_per_unit numeric NOT NULL DEFAULT 0;

ALTER TABLE public.packaging_costs
  ALTER COLUMN material_cost_per_unit SET DEFAULT 0;

ALTER TABLE public.packaging_costs
  ALTER COLUMN material_cost_per_unit SET NOT NULL;

-- products: split packaging_cost_override into material + labour overrides
ALTER TABLE public.products
  RENAME COLUMN packaging_cost_override TO packaging_material_override;

ALTER TABLE public.products
  ADD COLUMN packaging_labour_override numeric NULL;