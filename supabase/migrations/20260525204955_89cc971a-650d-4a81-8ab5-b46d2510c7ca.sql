UPDATE roast_groups SET standard_batch_kg = 20 WHERE standard_batch_kg IS NULL;

ALTER TABLE roast_groups
  ALTER COLUMN standard_batch_kg SET DEFAULT 20,
  ALTER COLUMN standard_batch_kg SET NOT NULL;

WITH next_start AS (
  SELECT COALESCE(MAX(display_order), 0) AS max_order FROM roast_groups
),
ranked AS (
  SELECT roast_group, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
  FROM roast_groups
  WHERE display_order IS NULL
)
UPDATE roast_groups r
SET display_order = ns.max_order + ranked.rn
FROM ranked, next_start ns
WHERE r.roast_group = ranked.roast_group;

ALTER TABLE roast_groups
  ALTER COLUMN display_order SET DEFAULT 9999,
  ALTER COLUMN display_order SET NOT NULL;