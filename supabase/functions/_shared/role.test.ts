import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { APP_ROLES, isAppRole, assertAppRole, isOneOfRoles } from './role.ts';

Deno.test('APP_ROLES contains exactly ADMIN, OPS, CLIENT', () => {
  assertEquals([...APP_ROLES].sort(), ['ADMIN', 'CLIENT', 'OPS']);
});

Deno.test('isAppRole accepts valid roles', () => {
  assertEquals(isAppRole('ADMIN'), true);
  assertEquals(isAppRole('OPS'), true);
  assertEquals(isAppRole('CLIENT'), true);
});

Deno.test('isAppRole rejects invalid/non-string values', () => {
  assertEquals(isAppRole('admin'), false);
  assertEquals(isAppRole('SUPERUSER'), false);
  assertEquals(isAppRole(''), false);
  assertEquals(isAppRole(null), false);
  assertEquals(isAppRole(undefined), false);
  assertEquals(isAppRole(42), false);
  assertEquals(isAppRole({ role: 'ADMIN' }), false);
});

Deno.test('assertAppRole returns role for valid input', () => {
  assertEquals(assertAppRole('OPS'), 'OPS');
});

Deno.test('assertAppRole throws for invalid input', () => {
  assertThrows(() => assertAppRole('NOPE'), Error, 'Invalid role');
  assertThrows(() => assertAppRole(null), Error, 'Invalid role');
});

Deno.test('isOneOfRoles filters to subset', () => {
  assertEquals(isOneOfRoles('ADMIN', ['ADMIN', 'OPS']), true);
  assertEquals(isOneOfRoles('OPS', ['ADMIN', 'OPS']), true);
  assertEquals(isOneOfRoles('CLIENT', ['ADMIN', 'OPS']), false);
  assertEquals(isOneOfRoles('bogus', ['ADMIN', 'OPS']), false);
});
