import { describe, it, expect } from 'vitest';
import { labelDate, roasterFirstName, machineName, labelHtml } from './batchLabel';

describe('batch label helpers', () => {
  it('formats the batch date as "OCT 28"', () => {
    expect(labelDate('2026-10-28')).toBe('OCT 28');
    expect(labelDate('2027-01-05')).toBe('JAN 5');
  });

  it('uses the label name, else the first word of the name', () => {
    expect(roasterFirstName({ label_name: 'Chris', name: 'G. Crispin Axl Fraser' })).toBe('Chris');
    expect(roasterFirstName({ label_name: null, name: 'Laura Hansen' })).toBe('Laura');
    expect(roasterFirstName(null)).toBeNull();
  });

  it('names machines', () => {
    expect(machineName('LORING')).toBe('Loring');
    expect(machineName('SAMIAC')).toBe('Samiac');
    expect(machineName('BLEND')).toBe('Blend');
    expect(machineName(null)).toBe('—');
  });

  it('builds a 4x6 portrait label with escaped text and blend components', () => {
    const html = labelHtml({
      batchDate: '2026-10-28',
      roastGroupName: 'Love <Hospital>',
      batchNumber: 'BL-1028-01',
      machineName: 'Blend',
      greenKg: 53.76,
      roastedKg: 53.76,
      components: ['S30-1028-01', 'S30-1028-02'],
      componentDetails: [{ roastGroupName: 'Ethiopia', batchNumber: 'S30-1028-02' }],
      products: [{ name: 'Love Hospital', accountCode: 'LHO' }],
    });
    expect(html).toContain('size: 4in 6in');
    expect(html).toContain('OCT 28');
    expect(html).toContain('Love &lt;Hospital&gt;');
    expect(html).toContain('S30-1028-02');
    expect(html).toContain('LHO');
    expect(html).not.toContain('53.8 kg');
  });
});
