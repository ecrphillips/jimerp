import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ownerRpc } from './ownerRpc';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useAccountLocations } from '@/hooks/useAccountLocations';

export interface PermissionValues {
  is_owner: boolean;
  can_place_orders: boolean;
  can_book_roaster: boolean;
  can_manage_locations: boolean;
  can_invite_users: boolean;
  location_access: string;
  assigned_location_ids: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  accountUserId: string;
  targetName: string;
  programs: string[];
  isOnlyOwner: boolean;
  initialValues: PermissionValues;
}

export function EditUserPermissionsDialog({
  open,
  onOpenChange,
  accountId,
  accountUserId,
  targetName,
  programs,
  isOnlyOwner,
  initialValues,
}: Props) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<PermissionValues>(initialValues);

  useEffect(() => {
    if (open) setValues(initialValues);
  }, [open, initialValues]);

  const { data: locations = [] } = useAccountLocations(accountId);

  const hasManufacturing = programs.includes('MANUFACTURING');
  const hasCoroasting = programs.includes('COROASTING');

  const mutation = useMutation({
    mutationFn: async (next: PermissionValues) => {
      const { error } = await ownerRpc('owner_update_user_permissions', {
        p_account_id: accountId,
        p_account_user_id: accountUserId,
        p_is_owner: next.is_owner,
        p_can_place_orders: hasManufacturing && next.can_place_orders,
        p_can_book_roaster: hasCoroasting && next.can_book_roaster,
        p_can_manage_locations: next.can_manage_locations,
        p_can_invite_users: next.can_invite_users,
        p_location_access: next.location_access,
        p_assigned_location_ids: next.location_access === 'ASSIGNED' ? next.assigned_location_ids : [],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Permissions updated');
      queryClient.invalidateQueries({ queryKey: ['account-team', accountId] });
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update permissions'),
  });

  const toggleAssignedLocation = (id: string, checked: boolean) => {
    setValues((v) => ({
      ...v,
      assigned_location_ids: checked
        ? [...v.assigned_location_ids, id]
        : v.assigned_location_ids.filter((x) => x !== id),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {targetName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2">
            {isOnlyOwner ? (
              <Tooltip>
                <TooltipTrigger className="flex items-center gap-2">
                  <Switch checked disabled />
                  <Label className="text-muted-foreground">Owner</Label>
                  <Lock className="h-3 w-3 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="text-xs max-w-xs">
                  An account must have at least one Owner. Promote another user to Owner first.
                </TooltipContent>
              </Tooltip>
            ) : (
              <>
                <Switch
                  checked={values.is_owner}
                  onCheckedChange={(v) => setValues({ ...values, is_owner: v })}
                />
                <Label>Owner</Label>
              </>
            )}
          </div>

          <div>
            <Label className="mb-2 block">Permissions</Label>
            <div className="grid grid-cols-1 gap-2">
              {hasManufacturing && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={values.can_place_orders}
                    onCheckedChange={(v) => setValues({ ...values, can_place_orders: !!v })}
                  />
                  Place orders
                </label>
              )}
              {hasCoroasting && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={values.can_book_roaster}
                    onCheckedChange={(v) => setValues({ ...values, can_book_roaster: !!v })}
                  />
                  Book roaster
                </label>
              )}
              {hasManufacturing && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={values.can_manage_locations}
                    onCheckedChange={(v) => setValues({ ...values, can_manage_locations: !!v })}
                  />
                  Manage locations
                </label>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={values.can_invite_users}
                  onCheckedChange={(v) => setValues({ ...values, can_invite_users: !!v })}
                />
                Invite team members
              </label>
            </div>
          </div>

          {hasManufacturing && (
            <div>
              <Label>Location access</Label>
              <Select
                value={values.location_access}
                onValueChange={(v) => setValues({ ...values, location_access: v })}
              >
                <SelectTrigger className="w-48 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Locations</SelectItem>
                  <SelectItem value="ASSIGNED">Assigned Only</SelectItem>
                </SelectContent>
              </Select>

              {values.location_access === 'ASSIGNED' && (
                <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-border">
                  <Label className="text-xs text-muted-foreground">Assigned locations</Label>
                  {locations.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No locations exist yet.</p>
                  ) : (
                    locations.map((loc) => (
                      <label key={loc.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={values.assigned_location_ids.includes(loc.id)}
                          onCheckedChange={(v) => toggleAssignedLocation(loc.id, !!v)}
                        />
                        <span className="font-mono text-xs">{loc.location_code}</span>
                        <span>{loc.location_name}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate(values)} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
