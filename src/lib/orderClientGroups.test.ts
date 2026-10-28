import { describe, expect, it } from 'vitest';
import { groupOrderClients, type OrderClient } from './orderClientGroups';

const client = (id: string, days: number[] | null = null, programs = ['MANUFACTURING']): OrderClient => ({
  id, account_name: id, production_weekdays: days, programs,
});

describe('order client grouping', () => {
  it('keeps clients with one or more production days in the first group', () => {
    const result = groupOrderClients([client('B', []), client('Z', [4]), client('A', [1, 3])]);
    expect(result.scheduled.map(c => c.id)).toEqual(['A', 'Z']);
    expect(result.other.map(c => c.id)).toEqual(['B']);
  });
  it('sorts the remaining clients alphabetically', () => {
    expect(groupOrderClients([client('Z'), client('B'), client('A')]).other.map(c => c.id)).toEqual(['A', 'B', 'Z']);
  });
  it('puts co-roasting-only accounts last even if they have production days', () => {
    const result = groupOrderClients([client('Co roast', [2], ['COROASTING']), client('Both', [2], ['MANUFACTURING', 'COROASTING'])]);
    expect(result.coroastingOnly.map(c => c.id)).toEqual(['Co roast']);
    expect(result.scheduled.map(c => c.id)).toEqual(['Both']);
  });
  it('includes clients with a specified location production day', () => {
    const result = groupOrderClients([client('Location schedule'), client('No schedule')], ['Location schedule']);
    expect(result.scheduled.map(c => c.id)).toEqual(['Location schedule']);
    expect(result.other.map(c => c.id)).toEqual(['No schedule']);
  });
});