import { describe, it, expect } from 'vitest';
import {
  rollUpGroupTier,
  orderPackGroups,
  type PackGroupMeta,
  type WipTier,
} from './packGroupSort';

describe('rollUpGroupTier', () => {
  const p = (wipStatus: WipTier, remainingUnits = 10) => ({ wipStatus, remainingUnits });

  it('all products fully covered -> full', () => {
    expect(rollUpGroupTier([p('full'), p('full')])).toBe('full');
  });

  it('a partial drags the group to partial', () => {
    expect(rollUpGroupTier([p('full'), p('partial')])).toBe('partial');
  });

  it('some covered, some none -> partial', () => {
    expect(rollUpGroupTier([p('full'), p('none')])).toBe('partial');
  });

  it('all none -> none', () => {
    expect(rollUpGroupTier([p('none'), p('none')])).toBe('none');
  });

  it('fully-packed products (no remaining demand) do not drag a group down', () => {
    // The 'none' product has nothing left to pack, so it is ignored.
    expect(rollUpGroupTier([p('full'), p('none', 0)])).toBe('full');
  });

  it('nothing left to pack -> none', () => {
    expect(rollUpGroupTier([p('full', 0), p('none', 0)])).toBe('none');
  });
});

describe('orderPackGroups', () => {
  const g = (
    roastGroup: string,
    tier: WipTier,
    roastTabIndex: number,
    earliestShipDate: string | null = null,
  ): PackGroupMeta => ({ roastGroup, displayName: roastGroup, tier, roastTabIndex, earliestShipDate });

  it('wip mode: full -> partial -> none', () => {
    const groups = [g('C', 'none', 0), g('A', 'full', 2), g('B', 'partial', 1)];
    expect(orderPackGroups(groups, 'wip')).toEqual(['A', 'B', 'C']);
  });

  it('wip mode: within the none tier, falls back to roast-tab order', () => {
    const groups = [g('Z', 'none', 2), g('Y', 'none', 0), g('X', 'none', 1)];
    expect(orderPackGroups(groups, 'wip')).toEqual(['Y', 'X', 'Z']);
  });

  it('alpha mode sorts by display name', () => {
    const groups = [g('Beta', 'none', 0), g('Alpha', 'full', 1)];
    expect(orderPackGroups(groups, 'alpha')).toEqual(['Alpha', 'Beta']);
  });

  it('oldest mode sorts earliest ship date first; nulls last', () => {
    const groups = [
      g('late', 'full', 0, '2026-06-10'),
      g('none', 'full', 1, null),
      g('early', 'full', 2, '2026-06-01'),
    ];
    expect(orderPackGroups(groups, 'oldest')).toEqual(['early', 'late', 'none']);
  });

  it('newest mode sorts latest ship date first; nulls last', () => {
    const groups = [
      g('late', 'full', 0, '2026-06-10'),
      g('early', 'full', 1, '2026-06-01'),
      g('none', 'full', 2, null),
    ];
    expect(orderPackGroups(groups, 'newest')).toEqual(['late', 'early', 'none']);
  });

  it('manual order wins when it covers the same group set', () => {
    const groups = [g('A', 'full', 0), g('B', 'none', 1), g('C', 'partial', 2)];
    expect(orderPackGroups(groups, 'wip', ['C', 'A', 'B'])).toEqual(['C', 'A', 'B']);
  });

  it('stale manual order (group set changed) is ignored, falls back to mode', () => {
    const groups = [g('A', 'full', 0), g('B', 'partial', 1)];
    // manual order references a group 'X' that no longer exists
    expect(orderPackGroups(groups, 'wip', ['X', 'A', 'B'])).toEqual(['A', 'B']);
  });
});
