import { supabase } from '@/integrations/supabase/client';
import { productAccessState } from './customerProductAccess';

/** Fresh account settings are checked just before staff save, not just when the selector loads. */
export async function confirmCaseOnlyOrder(accountId: string, productIds: string[]): Promise<string[] | null> {
  const [{ data: settings, error: settingsError }, { data: cases, error: casesError }] = await Promise.all([
    supabase.from('account_product_access').select('product_id, visible, orderable, case_only').eq('account_id', accountId),
    supabase.from('products').select('id, product_name, case_lot_product_id, is_active').not('case_lot_product_id', 'is', null),
  ]);
  if (settingsError) throw settingsError;
  if (casesError) throw casesError;
  const held = [...new Set(productIds)].filter(id => productAccessState(id, settings ?? [], cases ?? []).heldForCase);
  if (!held.length) return [];
  const { data: products, error } = await supabase.from('products').select('id, product_name, bag_size_g').in('id', held);
  if (error) throw error;
  const labels = (products ?? []).map(p => `${p.product_name} (${p.bag_size_g}g)`).join('\n');
  return window.confirm(`This customer orders these variants as Case Lots only:\n\n${labels}\n\nConfirm an internal order for individual units instead?`) ? held : null;
}