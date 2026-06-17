import { describe, it, expect } from 'vitest';
import {
  parseCsv, parseFunkCsv, cleanSubscriptionName, isDropName, parseBagSize,
  matchLineItem, placeholderName, nextPlaceholderSeq, parseDropCans, sumSlotCans,
  parseOrderDate, classifyOrders, buildShipNowGroups, aggregateBatchMonths,
  dropShipDate, dateStamp, slotProductName, dropBatchReference, monthShortYY,
  funkReferenceBase, nextBusinessDayDeadline,
  type ProductLite, type MappingLite,
} from './funkCsvImport';

describe('parseCsv', () => {
  it('handles quoted commas and embedded newlines', () => {
    const csv = 'a,b,c\n1,"two, with comma","line1\nline2"\n';
    const rows = parseCsv(csv);
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', 'two, with comma', 'line1\nline2'],
    ]);
  });

  it('handles escaped double quotes', () => {
    expect(parseCsv('x\n"he said ""hi"""')).toEqual([['x'], ['he said "hi"']]);
  });
});

describe('cleanSubscriptionName', () => {
  it('strips Subscription from a perennial sub line', () => {
    expect(cleanSubscriptionName('Technicolour Subscription - 2LB bag / Whole Beans'))
      .toBe('Technicolour - 2LB bag / Whole Beans');
  });
  it('leaves the DROP subscription box untouched', () => {
    const n = 'Drip Drip DROP Subscription Box';
    expect(cleanSubscriptionName(n)).toBe(n);
  });
  it('leaves non-subscription names untouched', () => {
    expect(cleanSubscriptionName('Technicolour - 250g / Whole Beans'))
      .toBe('Technicolour - 250g / Whole Beans');
  });
});

describe('isDropName', () => {
  it('detects DROP boxes case-insensitively', () => {
    expect(isDropName('Drip Drip DROP - March')).toBe(true);
    expect(isDropName('drip drip drop subscription box')).toBe(true);
    expect(isDropName('Technicolour')).toBe(false);
  });
});

describe('parseFunkCsv', () => {
  const csv = [
    'Name,Id,Lineitem name,Lineitem quantity,Lineitem sku',
    '#1001,5550000001,"Technicolour - 250g / Whole Beans",2,TECH-250-WB',
    '#1001,,"Technicolour Subscription - 250g / Whole Beans",1,',
    '#1002,5550000002,"Drip Drip DROP - March",1,DROP-MAR',
    '#1002,,"Technicolour - 2LB bag / Whole Beans",3,TECH-2LB-WB',
  ].join('\n');

  it('groups by Name and captures Id from the first row', () => {
    const { orders, error } = parseFunkCsv(csv);
    expect(error).toBeUndefined();
    expect(orders).toHaveLength(2);
    const o1 = orders.find((o) => o.name === '#1001')!;
    expect(o1.shopifyId).toBe('5550000001');
    expect(o1.lineItems).toHaveLength(2);
    expect(o1.lineItems[1].cleanedName).toBe('Technicolour - 250g / Whole Beans');
  });

  it('marks DROP lines', () => {
    const { orders } = parseFunkCsv(csv);
    const o2 = orders.find((o) => o.name === '#1002')!;
    expect(o2.lineItems[0].isDrop).toBe(true);
    expect(o2.lineItems[1].isDrop).toBe(false);
  });
});

describe('parseBagSize', () => {
  it('parses common sizes', () => {
    expect(parseBagSize('Technicolour - 2LB bag / Whole Beans').variant).toBe('BULK_2LB');
    expect(parseBagSize('X - 250g').variant).toBe('RETAIL_250G');
    expect(parseBagSize('X - 1kg').variant).toBe('BULK_1KG');
    expect(parseBagSize('X - 12oz').variant).toBe('RETAIL_340G');
  });
  it('falls back to generic 250g', () => {
    expect(parseBagSize('Mystery item')).toEqual({ variant: null, grams: 250 });
  });
});

describe('matchLineItem', () => {
  const products: ProductLite[] = [
    { id: 'p1', product_name: 'Technicolour - 250g / Whole Beans', sku: 'TECH-250-WB', is_placeholder: false, packaging_variant: 'RETAIL_250G', bag_size_g: 250, internal_packaging_notes: null },
    { id: 'ph', product_name: 'Placeholder One (1)', sku: null, is_placeholder: true, packaging_variant: null, bag_size_g: 250, internal_packaging_notes: 'Old thing' },
  ];

  it('uses a saved sku mapping as a final match', () => {
    const mappings: MappingLite[] = [{ csv_sku: 'TECH-250-WB', csv_product_name: null, product_id: 'p1' }];
    expect(matchLineItem('TECH-250-WB', 'whatever', products, mappings))
      .toEqual({ kind: 'matched', productId: 'p1' });
  });

  it('guesses by exact name (needs confirmation, never final)', () => {
    expect(matchLineItem('', 'Technicolour - 250g / Whole Beans', products, []))
      .toEqual({ kind: 'needs_confirmation', productId: 'p1' });
  });

  it('returns unmatched when nothing matches', () => {
    expect(matchLineItem('NOPE', 'Unknown Coffee', products, []))
      .toEqual({ kind: 'unmatched', productId: null });
  });

  it('ignores a mapping that points at a placeholder', () => {
    const mappings: MappingLite[] = [{ csv_sku: 'X', csv_product_name: null, product_id: 'ph' }];
    expect(matchLineItem('X', 'whatever', products, mappings).kind).toBe('unmatched');
  });
});

describe('placeholder naming', () => {
  it('names sequentially with words', () => {
    expect(placeholderName(1)).toBe('Placeholder One (1)');
    expect(placeholderName(2)).toBe('Placeholder Two (2)');
  });
  it('continues past existing placeholders', () => {
    const existing: ProductLite[] = [
      { id: 'a', product_name: 'Placeholder One (1)', sku: null, is_placeholder: true, packaging_variant: null, bag_size_g: 250, internal_packaging_notes: null },
      { id: 'b', product_name: 'Placeholder Three (3)', sku: null, is_placeholder: true, packaging_variant: null, bag_size_g: 250, internal_packaging_notes: null },
    ];
    expect(nextPlaceholderSeq(existing)).toBe(4);
  });
});

describe('parseDropCans', () => {
  it('reads the can count', () => {
    expect(parseDropCans('Drip Drip DROP - 2 x 250g')).toBe(2);
    expect(parseDropCans('Drip Drip DROP - 4 x 250g')).toBe(4);
    expect(parseDropCans('Drip Drip DROP - mystery')).toBeNull();
  });
});

describe('sumSlotCans', () => {
  it('splits cans evenly across both slots, scaled by line qty', () => {
    const line = (cans: number, qty: number): any => ({ isDrop: true, dropCans: cans, quantity: qty });
    expect(sumSlotCans([line(2, 1)])).toEqual({ slot1: 1, slot2: 1, ok: true });
    expect(sumSlotCans([line(4, 3)])).toEqual({ slot1: 6, slot2: 6, ok: true });
    expect(sumSlotCans([line(null as any, 1)])).toEqual({ slot1: 0, slot2: 0, ok: false });
  });
});

describe('parseOrderDate', () => {
  it('reads the leading calendar date', () => {
    expect(parseOrderDate('2026-06-10 08:00:00 -0700')).toEqual({ year: 2026, month: 6, day: 10 });
    expect(parseOrderDate('not a date')).toBeNull();
  });
});

describe('dropShipDate', () => {
  it('uses the 15th, rolling weekends back to Friday', () => {
    // Jun 2026: 15th is Monday -> 15.
    expect(dropShipDate(2026, 6)).toEqual({ year: 2026, month: 6, day: 15 });
    // Aug 2026: 15th is Saturday -> 14 (Fri).
    expect(dropShipDate(2026, 8)).toEqual({ year: 2026, month: 8, day: 14 });
    // Nov 2026: 15th is Sunday -> 13 (Fri).
    expect(dropShipDate(2026, 11)).toEqual({ year: 2026, month: 11, day: 13 });
  });
});

describe('naming + references', () => {
  it('builds slot names, month suffix, and batch refs', () => {
    expect(slotProductName(1, 2026, 6)).toBe('FUNK SUB ONE (1) - JUN 26');
    expect(slotProductName(2, 2026, 6)).toBe('FUNK SUB TWO (2) - JUN 26');
    expect(monthShortYY(2026, 1)).toBe('JAN 26');
    expect(dropBatchReference(2026, 6)).toBe('FUNK-DROP-2026-06');
    expect(dateStamp({ year: 2026, month: 6, day: 15 })).toBe('2026-06-15');
  });
});

describe('classifyOrders — hard-date routing', () => {
  const csv = (rows: string[][]) =>
    parseFunkCsv([
      'Name,Id,Created at,Lineitem name,Lineitem quantity,Lineitem sku',
      ...rows.map((r) => r.join(',')),
    ].join('\n')).orders;

  it('routes a pure DROP order dated <=14 to the batch (expanded)', () => {
    const orders = csv([['#1', '1', '2026-06-10 09:00:00 -0700', '"Drip Drip DROP - 2 x 250g"', '3', 'DROP2']]);
    const c = classifyOrders(orders);
    expect(c.shipNowOrders).toHaveLength(0);
    expect(c.decisionOrders).toHaveLength(0);
    expect(c.batchOrders).toHaveLength(1);
    expect(c.batchOrders[0]).toMatchObject({ year: 2026, month: 6, slot1Cans: 3, slot2Cans: 3 });
  });

  it('routes a pure DROP order dated >=15 to ship-now', () => {
    const orders = csv([['#2', '2', '2026-06-20 09:00:00 -0700', '"Drip Drip DROP - 4 x 250g"', '1', 'DROP4']]);
    const c = classifyOrders(orders);
    expect(c.shipNowOrders.map((o) => o.name)).toEqual(['#2']);
    expect(c.batchOrders).toHaveLength(0);
    expect(c.decisionOrders).toHaveLength(0);
  });

  it('routes a mixed order to needs-a-decision (canExpand from date+cans)', () => {
    const orders = csv([
      ['#3', '3', '2026-06-05 09:00:00 -0700', '"Drip Drip DROP - 2 x 250g"', '1', 'DROP2'],
      ['#3', '', '', '"Technicolour - 250g / Whole Beans"', '2', 'TECH'],
    ]);
    const c = classifyOrders(orders);
    expect(c.decisionOrders).toHaveLength(1);
    expect(c.decisionOrders[0]).toMatchObject({ reason: 'mixed', canExpand: true, slot1Cans: 1, slot2Cans: 1 });
    expect(c.decisionOrders[0].nonDropLines).toHaveLength(1);
  });

  it('routes an unparseable DROP order to needs-a-decision (cannot expand)', () => {
    const orders = csv([['#4', '4', '2026-06-05 09:00:00 -0700', '"Drip Drip DROP mystery box"', '1', 'DROPX']]);
    const c = classifyOrders(orders);
    expect(c.decisionOrders).toHaveLength(1);
    expect(c.decisionOrders[0]).toMatchObject({ reason: 'unparseable', canExpand: false });
  });

  it('routes a plain retail order to ship-now', () => {
    const orders = csv([['#5', '5', '2026-06-05 09:00:00 -0700', '"Technicolour - 250g / Whole Beans"', '4', 'TECH']]);
    const c = classifyOrders(orders);
    expect(c.shipNowOrders.map((o) => o.name)).toEqual(['#5']);
  });
});

describe('buildShipNowGroups + aggregateBatchMonths', () => {
  it('groups ship-now lines and sums batch demand by month', () => {
    const orders = parseFunkCsv([
      'Name,Id,Created at,Lineitem name,Lineitem quantity,Lineitem sku',
      '#1,1,2026-06-20 09:00:00 -0700,"Technicolour - 250g / Whole Beans",2,TECH',
      '#1,,,"Technicolour Subscription - 250g / Whole Beans",1,TECH',
    ].join('\n')).orders;
    const products: ProductLite[] = [
      { id: 'p1', product_name: 'Technicolour - 250g / Whole Beans', sku: 'TECH', is_placeholder: false, packaging_variant: 'RETAIL_250G', bag_size_g: 250, internal_packaging_notes: null },
    ];
    const groups = buildShipNowGroups(orders, products, []);
    // retail + subscription twin combine into one group by sku, qty 3.
    expect(groups).toHaveLength(1);
    expect(groups[0].totalQuantity).toBe(3);

    const months = aggregateBatchMonths([
      { order: { name: '#a', shopifyId: '', createdAt: '', lineItems: [] }, year: 2026, month: 6, slot1Cans: 1, slot2Cans: 1, heldLines: [] },
      { order: { name: '#b', shopifyId: '', createdAt: '', lineItems: [] }, year: 2026, month: 6, slot1Cans: 2, slot2Cans: 2, heldLines: [] },
    ]);
    expect(months).toHaveLength(1);
    expect(months[0]).toMatchObject({ year: 2026, month: 6, slot1Cans: 3, slot2Cans: 3 });
    expect(months[0].orderRefs.map((o) => o.name)).toEqual(['#a', '#b']);
  });
});

describe('reference + deadline helpers', () => {
  it('builds a dated reference', () => {
    expect(funkReferenceBase(new Date('2026-06-17T10:00:00'))).toBe('FUNK-CSV-2026-06-17');
  });
  it('skips weekends for the work deadline', () => {
    // Friday 2026-06-19 -> next business day is Monday 2026-06-22.
    expect(nextBusinessDayDeadline(new Date('2026-06-19T09:00:00'))).toBe('2026-06-22T17:00');
  });
});
