import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isValidEmail, isNonEmptyString, MAX_EMAIL_LEN } from './validation.ts';

Deno.test('isValidEmail accepts well-formed addresses', () => {
  assertEquals(isValidEmail('foo@bar.com'), true);
  assertEquals(isValidEmail('first.last+tag@sub.example.co.uk'), true);
  assertEquals(isValidEmail('a@b.c'), true);
});

Deno.test('isValidEmail rejects malformed addresses', () => {
  assertEquals(isValidEmail(''), false);
  assertEquals(isValidEmail('plainstring'), false);
  assertEquals(isValidEmail('missing@dot'), false);
  assertEquals(isValidEmail('@nouser.com'), false);
  assertEquals(isValidEmail('user@'), false);
  assertEquals(isValidEmail('has spaces@bar.com'), false);
  assertEquals(isValidEmail('double@@bar.com'), false);
});

Deno.test('isValidEmail rejects non-strings', () => {
  assertEquals(isValidEmail(null), false);
  assertEquals(isValidEmail(undefined), false);
  assertEquals(isValidEmail(42), false);
  assertEquals(isValidEmail({}), false);
});

Deno.test('isValidEmail enforces length cap', () => {
  const longLocal = 'a'.repeat(MAX_EMAIL_LEN);
  assertEquals(isValidEmail(`${longLocal}@b.co`), false);
});

Deno.test('isNonEmptyString', () => {
  assertEquals(isNonEmptyString('x'), true);
  assertEquals(isNonEmptyString(''), false);
  assertEquals(isNonEmptyString(null), false);
  assertEquals(isNonEmptyString(0), false);
});
