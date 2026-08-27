/**
 * Pricing sheet export.
 *
 * The workbook carries live formulas, not computed values. Opening it in Excel
 * and changing the yield loss recalculates every line, exactly as it does in
 * the app. A flat dump of results would be a screenshot with extra steps, and
 * would lose the one property that makes the sheet trustworthy: you can see
 * where each number came from and change it.
 *
 * Assumptions live on their own tab as named cells, so formulas on the pricing
 * tab read as English — `=MachineCostHr/Throughput` rather than `=B3/B2`.
 *
 * Unset inputs are written as the text "NOT SET" rather than left blank. Blank
 * cells are treated as zero by Excel arithmetic, which would silently price a
 * line below its true cost; the text makes dependent formulas fail loudly with
 * #VALUE! instead.
 */
import type { PricingAssumptions, PackSpeedBand } from './pricingAssumptions';
import { KG_PER_LB } from './pricingAssumptions';
import type { CostStackConfig, GreenBasis, PriceBreak, VolumeCadence } from './pricingEngine';
import type { WeightUnit } from '@/hooks/useWeightUnit';

export interface ExportLine {
  label: string;
  tierLabel: string;
  includes: CostStackConfig;
  greenBasis: GreenBasis;
  benchmarkPerKg: number | null;
  marketPerKg: number | null;
  gramsPerUnit: number | null;
  packagingMaterialPerUnit: number | null;
  servicesPerUnit: number | null;
  unitsPerPeriod: number | null;
}

export interface ExportInput {
  /**
   * The unit the workbook is written in. Rates, weights and labels all follow
   * it, and the other unit appears alongside for reference. Values arrive here
   * canonical (per green kg) and are converted once, on the way out.
   */
  unit: WeightUnit;
  assumptions: PricingAssumptions;
  bands: PackSpeedBand[];
  lines: ExportLine[];
  marginPerGreenKg: number | null;
  /** Volume breaks, exported as a lookup so the workbook reprices at volume. */
  priceBreaks?: PriceBreak[];
  cadence: VolumeCadence;
  /** Caller supplies this so the module stays free of ambient clock reads. */
  generatedAt: Date;
}

const NOT_SET = 'NOT SET';

/**
 * A rate per kg is a smaller number per lb; a weight in kg is a larger number
 * in lb. Converting both the same way would look plausible and misprice
 * everything, so they are separate.
 */
const rateOut = (unit: WeightUnit, perKg: number) =>
  unit === 'LB' ? perKg * KG_PER_LB : perKg;
const weightOut = (unit: WeightUnit, kg: number) => (unit === 'LB' ? kg / KG_PER_LB : kg);

/** A number, or the loud placeholder that makes dependent formulas fail. */
const val = (n: number | null | undefined): number | string =>
  n == null || !Number.isFinite(n) ? NOT_SET : n;

const MONEY_2 = '$#,##0.00';
const MONEY_4 = '$#,##0.0000';
const NUM_3 = '#,##0.000';

/** Assumption rows: [label, value, defined name, number format]. */
function assumptionRows(
  a: PricingAssumptions,
  unit: WeightUnit,
  wSuffix: string,
): Array<[string, number | string, string, string?]> {
  const tput = a.roast_throughput_green_kg_per_hr;
  return [
    [
      `Roast throughput (green ${wSuffix}/hr)`,
      tput == null ? NOT_SET : weightOut(unit, tput),
      'Throughput',
    ],
    ['Machine running cost ($/hr)', val(a.machine_running_cost_per_hr), 'MachineCostHr', MONEY_2],
    ['Salary ($/yr)', val(a.labour_salary_annual), 'Salary', MONEY_2],
    ['Weeks worked per year', val(a.labour_weeks_per_year), 'WeeksPerYear'],
    ['Hours per week', val(a.labour_hours_per_week), 'HoursPerWeek'],
    ['Oncosts (%)', val(a.labour_oncost_pct), 'OncostPct'],
    ['Standard yield loss (%)', val(a.standard_yield_loss_pct), 'YieldLossPct'],
  ];
}

export async function buildPricingWorkbook(input: ExportInput) {
  // Loaded on demand: exceljs is large and only needed when exporting.
  const ExcelJS = (await import('exceljs')).default;
  const unit = input.unit;
  const wSuffix = unit === 'LB' ? 'lb' : 'kg';
  const otherSuffix = unit === 'LB' ? 'kg' : 'lb';
  // Factor taking a figure in the workbook's unit to the other one.
  const rateToOther = unit === 'LB' ? `/${KG_PER_LB}` : `*${KG_PER_LB}`;
  const weightToOther = unit === 'LB' ? `*${KG_PER_LB}` : `/${KG_PER_LB}`;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Home Island Coffee Partners — JIM';
  wb.created = input.generatedAt;

  // ---------------------------------------------------------------- Assumptions
  const as = wb.addWorksheet('Assumptions');
  as.columns = [{ width: 34 }, { width: 16 }, { width: 52 }];

  as.getCell('A1').value = 'Pricing assumptions';
  as.getCell('A1').font = { bold: true, size: 14 };
  as.getCell('A2').value =
    'Change any value here and every line on the Pricing tab recalculates. ' +
    `Rates are per green ${wSuffix} throughout; ${otherSuffix} equivalents are shown for reference.`;
  as.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };

  let row = 4;
  for (const [label, value, name, fmt] of assumptionRows(input.assumptions, unit, wSuffix)) {
    as.getCell(`A${row}`).value = label;
    const cell = as.getCell(`B${row}`);
    cell.value = value;
    cell.name = name;
    if (fmt && typeof value === 'number') cell.numFmt = fmt;
    row += 1;
  }

  row += 1;
  as.getCell(`A${row}`).value = 'Derived';
  as.getCell(`A${row}`).font = { bold: true };
  row += 1;

  const derived: Array<[string, string, string, string]> = [
    ['Base labour rate ($/hr)', 'Salary/(WeeksPerYear*HoursPerWeek)', 'BaseLabour', MONEY_2],
    ['Loaded labour rate ($/hr)', 'BaseLabour*(1+OncostPct/100)', 'LoadedLabour', MONEY_2],
    // Named without a unit: the workbook may be in either, and a name saying
    // one while holding the other is the mismatch this all exists to avoid.
    [`Roaster running ($/green ${wSuffix})`, 'MachineCostHr/Throughput', 'MachineRate', MONEY_4],
    [`Roast labour ($/green ${wSuffix})`, 'LoadedLabour/Throughput', 'RoastLabourRate', MONEY_4],
    // Reference only, and formulas so they follow the rates above rather than
    // freezing a converted number beside a live one.
    [
      `Roaster running ($/green ${otherSuffix})`,
      `MachineRate${rateToOther}`,
      'MachineRateOther',
      MONEY_4,
    ],
    [
      `Roast labour ($/green ${otherSuffix})`,
      `RoastLabourRate${rateToOther}`,
      'RoastLabourRateOther',
      MONEY_4,
    ],
    [
      `Roast throughput (green ${otherSuffix}/hr)`,
      `Throughput${weightToOther}`,
      'ThroughputOther',
      NUM_3,
    ],
  ];

  for (const [label, formula, name, fmt] of derived) {
    as.getCell(`A${row}`).value = label;
    const cell = as.getCell(`B${row}`);
    cell.value = { formula };
    cell.name = name;
    cell.numFmt = fmt;
    as.getCell(`C${row}`).value = `= ${formula}`;
    as.getCell(`C${row}`).font = { color: { argb: 'FF888888' }, name: 'Consolas', size: 9 };
    row += 1;
  }

  row += 1;
  as.getCell(`A${row}`).value = 'Margin';
  as.getCell(`A${row}`).font = { bold: true };
  row += 1;

  as.getCell(`A${row}`).value = `Margin ($/green ${wSuffix})`;
  const marginCell = as.getCell(`B${row}`);
  marginCell.value =
    input.marginPerGreenKg == null ? NOT_SET : rateOut(unit, input.marginPerGreenKg);
  marginCell.name = 'MarginRate';
  if (typeof marginCell.value === 'number') marginCell.numFmt = MONEY_2;
  row += 1;

  as.getCell(`A${row}`).value = `Margin ($/green ${otherSuffix})`;
  as.getCell(`B${row}`).value = { formula: `MarginRate${rateToOther}` };
  as.getCell(`B${row}`).numFmt = MONEY_2;

  // --------------------------------------------------------------------- Bands
  const bs = wb.addWorksheet('Bands');
  bs.columns = [{ width: 26 }, { width: 12 }, { width: 12 }, { width: 14 }];
  bs.addRow(['Band', 'Min g', 'Max g', 'Units per hour']);
  bs.getRow(1).font = { bold: true };

  // Sorted ascending so the LOOKUP on the pricing tab resolves correctly.
  const sortedBands = [...input.bands].sort((a, b) => a.min_g - b.min_g);
  for (const b of sortedBands) {
    bs.addRow([b.label, b.min_g, b.max_g ?? '', val(b.units_per_hour)]);
  }
  const lastBand = sortedBands.length + 1;
  // LOOKUP over a sorted first column returns the row whose min_g is the
  // largest value not exceeding the weight — which is the matching band,
  // provided the bands tile without gaps.
  const bandLookup = (gramsRef: string) =>
    `LOOKUP(${gramsRef},Bands!$B$2:$B$${lastBand},Bands!$D$2:$D$${lastBand})`;

  bs.addRow([]);
  bs.addRow(['Bands must tile the whole range without gaps for the lookup to hold.']);
  bs.getRow(lastBand + 2).font = { italic: true, color: { argb: 'FF666666' } };

  // -------------------------------------------------------------------- Breaks
  // Sorted ascending, so LOOKUP resolves to the highest trigger a volume
  // reaches — the same rule the engine applies.
  const usableBreaks = (input.priceBreaks ?? [])
    .filter((b) => Number.isFinite(b.minUnitsPerPeriod) && b.marginPerGreenKg != null)
    .sort((a, b) => a.minUnitsPerPeriod - b.minUnitsPerPeriod);

  const brs = wb.addWorksheet('Breaks');
  brs.columns = [{ width: 22 }, { width: 22 }, { width: 22 }];
  brs.addRow([
    `From units per ${input.cadence === 'MONTHLY' ? 'month' : 'week'}`,
    `Margin $/green ${wSuffix}`,
    `Margin $/green ${otherSuffix}`,
  ]);
  brs.getRow(1).font = { bold: true };
  usableBreaks.forEach((b, i) => {
    const r = i + 2;
    brs.addRow([b.minUnitsPerPeriod, rateOut(unit, b.marginPerGreenKg as number)]);
    brs.getCell(`C${r}`).value = { formula: `B${r}${rateToOther}` };
    brs.getCell(`C${r}`).numFmt = MONEY_4;
    brs.getCell(`B${r}`).numFmt = MONEY_4;
  });
  brs.addRow([]);
  brs.addRow([
    usableBreaks.length === 0
      ? 'No volume breaks. Every line uses the base margin from Assumptions.'
      : 'A volume below the first trigger falls back to the base margin on Assumptions.',
  ]);
  brs.getRow(usableBreaks.length + 3).font = { italic: true, color: { argb: 'FF666666' } };

  const lastBreak = usableBreaks.length + 1;
  /**
   * The margin a line earns at its volume. LOOKUP errors below the first
   * trigger, and IFERROR turns that into the base dial — mirroring the engine,
   * where no break applying means the base margin stands.
   */
  const marginFormula = (unitsRef: string) =>
    usableBreaks.length === 0
      ? 'MarginRate'
      : `IFERROR(LOOKUP(${unitsRef},Breaks!$A$2:$A$${lastBreak},Breaks!$B$2:$B$${lastBreak}),MarginRate)`;

  // ------------------------------------------------------------------- Pricing
  const ps = wb.addWorksheet('Pricing');

  const headers = [
    'Line',
    'Configuration',
    'Included cost lines',
    'Green basis',
    `Benchmark $/${wSuffix}`,
    `Market $/${wSuffix}`,
    `Green used $/${wSuffix}`,
    'Roasted g/unit',
    `Green ${wSuffix}/unit`,
    'Packaging $/unit',
    'Pack units/hr',
    'Pack labour $/unit',
    'Services $/unit',
    'Green $/unit',
    'Roaster $/unit',
    'Roast labour $/unit',
    'COST FLOOR $/unit',
    'Margin $/unit',
    'PRICE $/unit',
    `Units per ${input.cadence === 'MONTHLY' ? 'month' : 'week'}`,
    'Revenue',
    'Margin total',
    `Margin $/green ${wSuffix} applied`,
  ];
  ps.addRow(headers);
  ps.getRow(1).font = { bold: true };
  ps.getRow(1).alignment = { wrapText: true, vertical: 'bottom' };
  ps.columns = headers.map((h, i) => ({ width: i === 0 ? 24 : i === 2 ? 30 : 15 }));
  ps.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

  input.lines.forEach((line, i) => {
    const r = i + 2;
    const inc = line.includes;

    const included = (Object.keys(inc) as Array<keyof CostStackConfig>)
      .filter((k) => inc[k])
      .join(', ');

    ps.getCell(`A${r}`).value = line.label;
    ps.getCell(`B${r}`).value = line.tierLabel;
    ps.getCell(`C${r}`).value = included;
    ps.getCell(`D${r}`).value = line.greenBasis;
    const asRate = (v: number | null) => (v == null ? NOT_SET : rateOut(unit, v));
    ps.getCell(`E${r}`).value = inc.green ? asRate(line.benchmarkPerKg) : 0;
    ps.getCell(`F${r}`).value = inc.green ? asRate(line.marketPerKg) : 0;

    // Green used follows the basis, so switching D recalculates the line.
    ps.getCell(`G${r}`).value = inc.green
      ? { formula: `IF(D${r}="BENCHMARK",E${r},F${r})` }
      : 0;

    ps.getCell(`H${r}`).value = val(line.gramsPerUnit);
    // Grams roasted to green weight, then into the workbook's unit. Rates above
    // are per that same unit, so the products below stay in dollars either way.
    ps.getCell(`I${r}`).value = {
      formula:
        unit === 'LB'
          ? `H${r}/1000/(1-YieldLossPct/100)/${KG_PER_LB}`
          : `H${r}/1000/(1-YieldLossPct/100)`,
    };
    ps.getCell(`J${r}`).value = inc.packagingMaterial ? val(line.packagingMaterialPerUnit) : 0;
    ps.getCell(`K${r}`).value = inc.packLabour
      ? { formula: bandLookup(`H${r}`) }
      : 0;
    ps.getCell(`L${r}`).value = inc.packLabour
      ? { formula: `IF(K${r}=0,0,LoadedLabour/K${r})` }
      : 0;
    ps.getCell(`M${r}`).value = inc.downstreamServices ? val(line.servicesPerUnit ?? 0) : 0;

    ps.getCell(`N${r}`).value = { formula: `G${r}*I${r}` };
    ps.getCell(`O${r}`).value = inc.roasterRunning
      ? { formula: `MachinePerKg*I${r}` }
      : 0;
    ps.getCell(`P${r}`).value = inc.roastLabour
      ? { formula: `RoastLabourPerKg*I${r}` }
      : 0;

    ps.getCell(`Q${r}`).value = {
      formula: `N${r}+O${r}+P${r}+J${r}+L${r}+M${r}`,
      date1904: false,
    };
    ps.getCell(`W${r}`).value = { formula: marginFormula(`T${r}`) };
    ps.getCell(`R${r}`).value = { formula: `W${r}*I${r}` };
    ps.getCell(`S${r}`).value = { formula: `Q${r}+R${r}` };

    ps.getCell(`T${r}`).value = val(line.unitsPerPeriod);
    ps.getCell(`U${r}`).value = { formula: `S${r}*T${r}` };
    ps.getCell(`V${r}`).value = { formula: `R${r}*T${r}` };

    for (const col of ['E', 'F', 'G', 'J', 'L', 'M', 'N', 'O', 'P', 'R', 'W']) {
      ps.getCell(`${col}${r}`).numFmt = MONEY_4;
    }
    for (const col of ['Q', 'S', 'U', 'V']) {
      ps.getCell(`${col}${r}`).numFmt = MONEY_2;
    }
    ps.getCell(`I${r}`).numFmt = NUM_3;

    ps.getCell(`Q${r}`).font = { bold: true, color: { argb: 'FF9E3B2E' } };
    ps.getCell(`S${r}`).font = { bold: true, color: { argb: 'FF2F6B4F' } };
  });

  // Totals
  const totalRow = input.lines.length + 2;
  if (input.lines.length > 0) {
    const last = input.lines.length + 1;
    ps.getCell(`A${totalRow}`).value = 'Total';
    ps.getCell(`A${totalRow}`).font = { bold: true };
    ps.getCell(`U${totalRow}`).value = { formula: `SUM(U2:U${last})` };
    ps.getCell(`V${totalRow}`).value = { formula: `SUM(V2:V${last})` };
    for (const col of ['U', 'V']) {
      ps.getCell(`${col}${totalRow}`).numFmt = MONEY_2;
      ps.getCell(`${col}${totalRow}`).font = { bold: true };
    }
  }

  const noteRow = totalRow + 2;
  ps.getCell(`A${noteRow}`).value =
    'Cells reading NOT SET have no value in the app. Dependent formulas show #VALUE! rather than ' +
    'treating them as zero, which would understate cost. A cost line excluded by the ' +
    'configuration is written as 0 — see the included cost lines column.';
  ps.getCell(`A${noteRow}`).font = { italic: true, color: { argb: 'FF666666' } };

  return wb;
}

/** Filename stem, dated so saved versions sort. */
export function exportFilename(generatedAt: Date, ext: string): string {
  const iso = generatedAt.toISOString().slice(0, 10);
  return `pricing-sheet-${iso}.${ext}`;
}

/** Build and hand the workbook to the browser as a download. */
export async function downloadPricingWorkbook(input: ExportInput): Promise<void> {
  const wb = await buildPricingWorkbook(input);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFilename(input.generatedAt, 'xlsx');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
