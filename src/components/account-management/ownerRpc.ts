import { supabase } from '@/integrations/supabase/client';

// Thin wrapper for RPCs added by the account-owner self-service migration.
// Types in src/integrations/supabase/types.ts are auto-generated and do not
// yet include these functions; regenerate with `supabase gen types` to drop
// this file. Until then, casting keeps the call sites tidy and type-safe at
// the boundary while skipping the unknown-name compile error.
type OwnerRpcName =
  | 'owner_update_account'
  | 'owner_update_user_permissions'
  | 'owner_deactivate_user'
  | 'owner_create_location';

type OwnerRpcResult<T = unknown> = { data: T | null; error: { message: string } | null };

export function ownerRpc<T = unknown>(
  fn: OwnerRpcName,
  args: Record<string, unknown>
): Promise<OwnerRpcResult<T>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase.rpc as any)(fn, args);
}
