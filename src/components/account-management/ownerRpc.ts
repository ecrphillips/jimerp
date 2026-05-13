import { supabase } from '@/integrations/supabase/client';

// Thin pass-through to supabase.rpc for the account-owner self-service RPCs.
// Types are now generated, so this just narrows the function-name union.
type OwnerRpcName =
  | 'owner_update_account'
  | 'owner_update_user_permissions'
  | 'owner_deactivate_user'
  | 'owner_create_location';

export function ownerRpc(fn: OwnerRpcName, args: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase.rpc as any)(fn, args);
}
