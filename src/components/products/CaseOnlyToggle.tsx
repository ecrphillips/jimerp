import { Switch } from '@/components/ui/switch';
import { useAccountProductAccess } from '@/hooks/useAccountProductAccess';

export function CaseOnlyToggle({ accountId, productId }: { accountId: string; productId: string }) {
  const access = useAccountProductAccess(accountId);
  const setting = access.data?.find(s => s.product_id === productId) ?? { product_id: productId, visible: true, orderable: true, case_only: false };
  return <label className="mt-2 flex items-center gap-2 text-xs">
    <Switch aria-label="Case lot only for this customer" checked={setting.case_only} disabled={access.isLoading || !!access.error || access.save.isPending} onCheckedChange={case_only => access.save.mutate({ ...setting, case_only })} />
    Case lot only
  </label>;
}