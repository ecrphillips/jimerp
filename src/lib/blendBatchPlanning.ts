export interface BlendBatchComponent {
  roastGroup: string;
  pct: number;
  outputPerBatchKg: number;
  availableKg: number;
  batchCount: number;
}

/** Smallest practical whole-batch recipe set, using execution's ±2% tolerance. */
export function wholeBatchRecipe(components: BlendBatchComponent[]): number[] | null {
  if (!components.length || components.some(c => c.pct <= 0 || c.outputPerBatchKg <= 0)) return null;
  const anchor = components.reduce((best, c, i) =>
    c.pct / c.outputPerBatchKg < components[best].pct / components[best].outputPerBatchKg ? i : best, 0);
  for (let n = 1; n <= 200; n++) {
    const total = n * components[anchor].outputPerBatchKg / (components[anchor].pct / 100);
    const counts = components.map(c => Math.max(1, Math.round(total * c.pct / 100 / c.outputPerBatchKg)));
    const actualTotal = components.reduce((sum, c, i) => sum + counts[i] * c.outputPerBatchKg, 0);
    if (components.every((c, i) => Math.abs(counts[i] * c.outputPerBatchKg / actualTotal * 100 - c.pct) <= 2)) return counts;
  }
  return null;
}

export function planBlendBatches(components: BlendBatchComponent[], demandKg: number, allowPartial = false) {
  const recipe = wholeBatchRecipe(components);
  const setKg = recipe ? components.reduce((sum, c, i) => sum + recipe[i] * c.outputPerBatchKg, 0) : 0;
  // Include already earmarked batches so completing the recipe doesn't strand them.
  const sets = recipe && demandKg > 0 ? Math.max(
    Math.ceil((demandKg - 0.001) / setKg),
    ...components.map((c, i) => Math.ceil(c.batchCount / recipe[i])),
  ) : 0;
  const rows = components.map((c, i) => {
    const targetCount = recipe ? sets * recipe[i] : 0;
    const requiredKg = allowPartial ? Math.max(0, demandKg) * c.pct / 100 : targetCount * c.outputPerBatchKg;
    const shortKg = allowPartial
      ? Math.max(0, requiredKg - c.availableKg)
      : Math.max(0, targetCount - c.batchCount) * c.outputPerBatchKg;
    return { roastGroup: c.roastGroup, requiredKg, targetCount, shortKg,
      additionalBatches: allowPartial ? Math.max(0, Math.ceil((shortKg - 0.001) / c.outputPerBatchKg)) : Math.max(0, targetCount - c.batchCount) };
  });
  return { rows, recipe, targetKg: allowPartial ? Math.max(0, demandKg) : sets * setKg,
    covered: (allowPartial || recipe !== null) && rows.every(r => r.shortKg <= 0.001) };
}

export function canUseBlendAmounts(selections: { consumeKg: number; availableKg: number }[], allowPartial: boolean) {
  return selections.every(s => s.consumeKg > 0 && (allowPartial || Math.abs(s.consumeKg - s.availableKg) <= 0.001));
}