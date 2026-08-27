import { describe, it, expect } from 'vitest';
import { buildPricingWorkbook, exportFilename, type ExportInput } from './pricingExport';
import type { PricingAssumptions, PackSpeedBand } from './pricingAssumptions';
import type { CostStackConfig } from './pricingEngine';
import { KG_PER_LB } from './pricingAssumptions';

const A: PricingAssumptions = {
  roast_throughput_green_kg_per_hr: 50,
  machine_running_cost_per_hr: 10,
  labour_salary_annual: 100000,
  labour_weeks_per_year: 50,
  labour_hours_per_week: 40,
  labour_oncost_pct: 10,
  standard_yield_loss_pct: 17,
  green_financing_days: 60,
  green_financing_apr_pct: 12,
};

const BANDS: PackSpeedBand[] = [
  { id: '1', label: 'Up to 454g', min_g: 0, max_g: 454, units_per_hour: 100, display_order: 1 },
  { id: '2', label: '455-1135g', min_g: 455, max_g: 1135, units_per_hour: 50, display_order: 2 },
  { id: '3', label: '1136-2270g', min_g: 1136, max_g: 2270, units_per_hour: 25, display_order: 3 },
  { id: '4', label: 'Over 2270g', min_g: 2271, max_g: null, units_per_hour: 10, display_order: 4 },
];

const FULL: CostStackConfig = {
  green: true,
  roasterRunning: true,
  roastLabour: true,
  packagingMaterial: true,
  packLabour: true,
  downstreamServices: false,
};

const TOLL: CostStackConfig = { ...FULL, green: false, packagingMaterial: false, packLabour: false };

const input = (over: Partial<ExportInput> = {}): ExportInput => ({
  unit: 'KG',
  assumptions: A,
  bands: BANDS,
  marginPerGreenKg: 4,
  cadence: 'MONTHLY',
  generatedAt: new Date('2026-08-27T12:00:00Z'),
  lines: [
    {
      label: 'House Espresso 340g',
      tierLabel: 'Private label',
      includes: FULL,
      greenBasis: 'BENCHMARK',
      benchmarkPerKg: 8,
      marketPerKg: 6.5,
      gramsPerUnit: 340,
      packagingMaterialPerUnit: 0.75,
      servicesPerUnit: null,
      unitsPerPeriod: 200,
    },
  ],
  ...over,
});

const cellOf = async (sheet: string, ref: string, over: Partial<ExportInput> = {}) => {
  const wb = await buildPricingWorkbook(input(over));
  return wb.getWorksheet(sheet)!.getCell(ref);
};

describe('workbook structure', () => {
  it('has the four tabs the sheet needs', async () => {
    const wb = await buildPricingWorkbook(input());
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Assumptions',
      'Bands',
      'Breaks',
      'Pricing',
    ]);
  });

  it('dates the filename so saved versions sort', () => {
    expect(exportFilename(new Date('2026-08-27T12:00:00Z'), 'xlsx')).toBe(
      'pricing-sheet-2026-08-27.xlsx',
    );
  });
});

describe('formulas survive the round trip — Gate E', () => {
  it('derives the labour rate rather than writing the computed number', async () => {
    const wb = await buildPricingWorkbook(input());
    const as = wb.getWorksheet('Assumptions')!;
    const found: string[] = [];
    as.eachRow((r) =>
      r.eachCell((c) => {
        if (typeof c.value === 'object' && c.value && 'formula' in c.value) {
          found.push((c.value as { formula: string }).formula);
        }
      }),
    );
    expect(found).toContain('Salary/(WeeksPerYear*HoursPerWeek)');
    expect(found).toContain('BaseLabour*(1+OncostPct/100)');
    expect(found).toContain('MachineCostHr/Throughput');
    expect(found).toContain('LoadedLabour/Throughput');
  });

  it('names assumption cells so pricing formulas read as English', async () => {
    const cell = await cellOf('Assumptions', 'B4');
    expect(cell.name).toBe('Throughput');
  });

  it('computes green consumed from the yield assumption, not as a constant', async () => {
    const cell = await cellOf('Pricing', 'I2');
    expect((cell.value as { formula: string }).formula).toBe('H2/1000/(1-YieldLossPct/100)');
  });

  it('builds the cost floor by summing the line cells', async () => {
    const cell = await cellOf('Pricing', 'Q2');
    expect((cell.value as { formula: string }).formula).toBe('N2+O2+P2+J2+L2+M2');
  });

  it('builds the price as floor plus margin', async () => {
    const cell = await cellOf('Pricing', 'S2');
    expect((cell.value as { formula: string }).formula).toBe('Q2+R2');
  });

  it('drives margin from the resolved rate times green consumed', async () => {
    const cell = await cellOf('Pricing', 'R2');
    expect((cell.value as { formula: string }).formula).toBe('W2*I2');
  });

  it('falls back to the base dial when there are no breaks', async () => {
    const cell = await cellOf('Pricing', 'W2');
    expect((cell.value as { formula: string }).formula).toBe('MarginRate');
  });

  it('looks pack speed up from the bands tab rather than freezing it', async () => {
    const cell = await cellOf('Pricing', 'K2');
    expect((cell.value as { formula: string }).formula).toBe(
      'LOOKUP(H2,Bands!$B$2:$B$5,Bands!$D$2:$D$5)',
    );
  });

  it('switches green source on the basis cell, so changing it recalculates', async () => {
    const cell = await cellOf('Pricing', 'G2');
    expect((cell.value as { formula: string }).formula).toBe('IF(D2="BENCHMARK",E2,F2)');
  });
});

describe('volume breaks reprice inside the workbook', () => {
  const BREAKS = [
    { minUnitsPerPeriod: 200, marginPerGreenKg: 9 },
    { minUnitsPerPeriod: 500, marginPerGreenKg: 8 },
  ];

  it('looks the margin up from the line volume', async () => {
    const cell = await cellOf('Pricing', 'W2', { priceBreaks: BREAKS });
    expect((cell.value as { formula: string }).formula).toBe(
      'IFERROR(LOOKUP(T2,Breaks!$A$2:$A$3,Breaks!$B$2:$B$3),MarginRate)',
    );
  });

  it('sorts breaks ascending so the lookup resolves correctly', async () => {
    const wb = await buildPricingWorkbook(input({ priceBreaks: [BREAKS[1], BREAKS[0]] }));
    const brs = wb.getWorksheet('Breaks')!;
    expect([2, 3].map((r) => brs.getCell(`A${r}`).value)).toEqual([200, 500]);
  });

  it('omits a tier with no margin, matching the engine', async () => {
    const wb = await buildPricingWorkbook(input({
      priceBreaks: [...BREAKS, { minUnitsPerPeriod: 1000, marginPerGreenKg: null }],
    }));
    const brs = wb.getWorksheet('Breaks')!;
    expect(brs.getCell('A4').value).toBeFalsy();
  });

  it('says so when there are no breaks rather than leaving the tab bare', async () => {
    const wb = await buildPricingWorkbook(input());
    const brs = wb.getWorksheet('Breaks')!;
    expect(String(brs.getCell('A3').value)).toContain('No volume breaks');
  });
});

describe('the workbook is written in the chosen unit', () => {
  it('labels and states kilograms by default', async () => {
    const wb = await buildPricingWorkbook(input());
    const note = String(wb.getWorksheet('Assumptions')!.getCell('A2').value);
    expect(note).toContain('per green kg');
    expect(wb.getWorksheet('Pricing')!.getCell('I1').value).toBe('Green kg/unit');
  });

  it('labels and states pounds when asked', async () => {
    const wb = await buildPricingWorkbook(input({ unit: 'LB' }));
    const note = String(wb.getWorksheet('Assumptions')!.getCell('A2').value);
    expect(note).toContain('per green lb');
    expect(wb.getWorksheet('Pricing')!.getCell('I1').value).toBe('Green lb/unit');
    expect(wb.getWorksheet('Pricing')!.getCell('E1').value).toBe('Benchmark $/lb');
  });

  it('writes throughput in pounds per hour, converted from the stored kilograms', async () => {
    const wb = await buildPricingWorkbook(input({ unit: 'LB' }));
    const as = wb.getWorksheet('Assumptions')!;
    // The fixture roasts 50 green kg/hr, which is about 110.2 green lb/hr —
    // a weight gets larger when counted in the smaller unit.
    expect(Number(as.getCell('B4').value)).toBeCloseTo(50 / KG_PER_LB, 4);
    expect(String(as.getCell('A4').value)).toContain('green lb/hr');
  });

  it('converts green weight per unit into pounds on the pricing tab', async () => {
    const kg = await cellOf('Pricing', 'I2');
    expect((kg.value as { formula: string }).formula).toBe('H2/1000/(1-YieldLossPct/100)');
    const lb = await cellOf('Pricing', 'I2', { unit: 'LB' });
    expect((lb.value as { formula: string }).formula).toBe(
      `H2/1000/(1-YieldLossPct/100)/${KG_PER_LB}`,
    );
  });

  it('writes the margin dial in pounds, smaller than the per-kilogram figure', async () => {
    const wb = await buildPricingWorkbook(input({ unit: 'LB', marginPerGreenKg: 11.5743 }));
    const as = wb.getWorksheet('Assumptions')!;
    let margin: unknown = null;
    as.eachRow((r) => r.eachCell((c) => { if (c.name === 'MarginRate') margin = c.value; }));
    // A rate falls when restated per pound: $11.57/kg is $5.25/lb.
    expect(Number(margin)).toBeCloseTo(5.25, 3);
  });

  it('names the rate cells without a unit, since the workbook may be either', async () => {
    const wb = await buildPricingWorkbook(input({ unit: 'LB' }));
    const as = wb.getWorksheet('Assumptions')!;
    const names: string[] = [];
    as.eachRow((r) => r.eachCell((c) => { if (c.name) names.push(c.name); }));
    // A cell called MarginPerKg holding a per-pound figure is the mismatch
    // this whole change exists to remove.
    expect(names).toContain('MarginRate');
    expect(names).not.toContain('MarginPerKg');
  });
});

describe('the other unit is carried for reference', () => {
  it('derives it from the primary rate rather than freezing it', async () => {
    const wb = await buildPricingWorkbook(input());
    const as = wb.getWorksheet('Assumptions')!;
    const found: string[] = [];
    as.eachRow((r) =>
      r.eachCell((c) => {
        if (typeof c.value === 'object' && c.value && 'formula' in c.value) {
          found.push((c.value as { formula: string }).formula);
        }
      }),
    );
    // A converted constant would go stale the moment the primary rate moved.
    expect(found.some((f) => f.startsWith('MachineRate'))).toBe(true);
    expect(found.some((f) => f.startsWith('RoastLabourRate'))).toBe(true);
    expect(found.some((f) => f.startsWith('Throughput'))).toBe(true);
  });

  it('converts the reference the correct way in each direction', async () => {
    const inKg = await buildPricingWorkbook(input());
    const inLb = await buildPricingWorkbook(input({ unit: 'LB' }));
    const formulaFor = (wb: Awaited<ReturnType<typeof buildPricingWorkbook>>, name: string) => {
      let out = '';
      wb.getWorksheet('Assumptions')!.eachRow((r) =>
        r.eachCell((c) => {
          if (c.name === name && typeof c.value === 'object' && c.value && 'formula' in c.value) {
            out = (c.value as { formula: string }).formula;
          }
        }),
      );
      return out;
    };
    // In a kilogram workbook the pound reference multiplies; in a pound
    // workbook the kilogram reference divides.
    expect(formulaFor(inKg, 'MachineRateOther')).toBe(`MachineRate*${KG_PER_LB}`);
    expect(formulaFor(inLb, 'MachineRateOther')).toBe(`MachineRate/${KG_PER_LB}`);
  });

  it('gives each break a reference column driven by its primary cell', async () => {
    const wb = await buildPricingWorkbook(
      input({ priceBreaks: [{ minUnitsPerPeriod: 200, marginPerGreenKg: 9 }] }),
    );
    const brs = wb.getWorksheet('Breaks')!;
    expect((brs.getCell('C2').value as { formula: string }).formula).toMatch(/^B2[*/]/);
  });
});

describe('unset values fail loudly rather than becoming zero', () => {
  it('writes NOT SET for a missing assumption', async () => {
    const cell = await cellOf('Assumptions', 'B4', {
      assumptions: { ...A, roast_throughput_green_kg_per_hr: null },
    });
    expect(cell.value).toBe('NOT SET');
  });

  it('writes NOT SET for a missing line input', async () => {
    const rows = input().lines.map((l) => ({ ...l, gramsPerUnit: null }));
    const cell = await cellOf('Pricing', 'H2', { lines: rows });
    expect(cell.value).toBe('NOT SET');
  });

  it('writes NOT SET for a missing band speed', async () => {
    const cell = await cellOf('Bands', 'D2', {
      bands: BANDS.map((b) => ({ ...b, units_per_hour: null })),
    });
    expect(cell.value).toBe('NOT SET');
  });

  it('writes NOT SET for an unset margin dial', async () => {
    const wb = await buildPricingWorkbook(input({ marginPerGreenKg: null }));
    const as = wb.getWorksheet('Assumptions')!;
    let marginCell: unknown = null;
    as.eachRow((r) =>
      r.eachCell((c) => {
        if (c.name === 'MarginRate') marginCell = c.value;
      }),
    );
    expect(marginCell).toBe('NOT SET');
  });
});

describe('excluded cost lines', () => {
  it('writes zero rather than a formula when a line is not charged', async () => {
    const rows = input().lines.map((l) => ({ ...l, includes: TOLL }));
    const wb = await buildPricingWorkbook(input({ lines: rows }));
    const ps = wb.getWorksheet('Pricing')!;
    expect(ps.getCell('G2').value).toBe(0); // green
    expect(ps.getCell('J2').value).toBe(0); // packaging
    expect(ps.getCell('L2').value).toBe(0); // pack labour
  });

  it('records which lines the configuration includes', async () => {
    const rows = input().lines.map((l) => ({ ...l, includes: TOLL }));
    const cell = await cellOf('Pricing', 'C2', { lines: rows });
    expect(cell.value).toBe('roasterRunning, roastLabour');
  });

  it('still charges roasting on a toll line', async () => {
    const rows = input().lines.map((l) => ({ ...l, includes: TOLL }));
    const wb = await buildPricingWorkbook(input({ lines: rows }));
    const ps = wb.getWorksheet('Pricing')!;
    expect((ps.getCell('O2').value as { formula: string }).formula).toBe('MachinePerKg*I2');
    expect((ps.getCell('P2').value as { formula: string }).formula).toBe('RoastLabourPerKg*I2');
  });
});

describe('bands tab', () => {
  it('sorts bands ascending so the LOOKUP resolves correctly', async () => {
    const shuffled = [BANDS[2], BANDS[0], BANDS[3], BANDS[1]];
    const wb = await buildPricingWorkbook(input({ bands: shuffled }));
    const bs = wb.getWorksheet('Bands')!;
    expect([2, 3, 4, 5].map((r) => bs.getCell(`B${r}`).value)).toEqual([0, 455, 1136, 2271]);
  });

  it('leaves the open-ended band with no upper bound', async () => {
    const cell = await cellOf('Bands', 'C5');
    expect(cell.value).toBe('');
  });
});

describe('totals', () => {
  it('sums revenue and margin across lines', async () => {
    const two = [...input().lines, { ...input().lines[0], label: 'Second' }];
    const wb = await buildPricingWorkbook(input({ lines: two }));
    const ps = wb.getWorksheet('Pricing')!;
    expect((ps.getCell('U4').value as { formula: string }).formula).toBe('SUM(U2:U3)');
    expect((ps.getCell('V4').value as { formula: string }).formula).toBe('SUM(V2:V3)');
  });
});
