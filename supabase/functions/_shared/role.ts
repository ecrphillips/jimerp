// Shared role enum + validation for edge functions.
// Keep in sync with the `app_role` Postgres enum and AuthContext role usage.

export const APP_ROLES = ['ADMIN', 'OPS', 'CLIENT'] as const;
export type AppRole = typeof APP_ROLES[number];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value);
}

export function assertAppRole(value: unknown): AppRole {
  if (!isAppRole(value)) {
    throw new Error(`Invalid role: expected one of ${APP_ROLES.join(', ')}`);
  }
  return value;
}

export function isOneOfRoles(value: unknown, allowed: readonly AppRole[]): value is AppRole {
  return isAppRole(value) && allowed.includes(value);
}
