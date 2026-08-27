import { describe, it, expect } from 'vitest';
import { buildPricingWorkbook, exportFilename, type ExportInput } from './pricingExport';
import type { PricingAssumptions, PackSpeedBand } from './pricingAssumptions';
import type { CostStackConfig } from './pricingEngine';

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
  it('has the three tabs the sheet needs', async () => {
    const wb = await buildPricingWorkbook(input());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Assumptions', 'Bands', 'Pricing']);
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

  it('drives margin from the shared dial', async () => {
    const cell = await cellOf('Pricing', 'R2');
    expect((cell.value as { formula: string }).formula).toBe('MarginPerKg*I2');
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
        if (c.name === 'MarginPerKg') marginCell = c.value;
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
