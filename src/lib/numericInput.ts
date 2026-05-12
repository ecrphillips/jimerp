import type React from 'react';

const BLOCKED_KEYS = new Set(['.', ',', 'e', 'E', '+', '-']);

export function blockNonIntegerKeys(e: React.KeyboardEvent<HTMLInputElement>) {
  if (BLOCKED_KEYS.has(e.key)) {
    e.preventDefault();
  }
}
