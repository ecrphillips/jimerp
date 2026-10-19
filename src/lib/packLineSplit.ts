export interface PackSplitSource {
  units: number;
  wholeBeanUnits: number;
  grindUnits: number;
  grindByLabel: Record<string, number>;
}

/** Each bag belongs to exactly one whole-bean or grind-type line. */
export function splitPackLine<T extends PackSplitSource>(leaf: T): (T & { grindLabel: string | null })[] {
  const rows: (T & { grindLabel: string | null })[] = [];
  if (leaf.wholeBeanUnits > 0) rows.push({ ...leaf, units: leaf.wholeBeanUnits, grindUnits: 0, grindByLabel: {}, grindLabel: null });
  for (const [label, units] of Object.entries(leaf.grindByLabel)) {
    if (units > 0) rows.push({ ...leaf, units, wholeBeanUnits: 0, grindUnits: units, grindByLabel: { [label]: units }, grindLabel: label });
  }
  return rows;
}

export function packLineProgress(units: number, packed: number) {
  return { packed: Math.min(units, Math.max(0, packed)), needed: units, complete: units > 0 && packed >= units };
}

export function remainingPackWeightKg(leaves: { units: number; packed: number; bagSizeG: number; requiresProduction: boolean }[]) {
  return leaves.reduce((sum, leaf) => sum + (leaf.requiresProduction ? Math.max(0, leaf.units - leaf.packed) * leaf.bagSizeG / 1000 : 0), 0);
}