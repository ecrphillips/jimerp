import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAccountLocations } from '@/hooks/useAccountLocations';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  programs: string[];
}

interface InviteForm {
  email: string;
  can_place_orders: boolean;
  can_book_roaster: boolean;
  can_manage_locations: boolean;
  can_invite_users: boolean;
  location_access: string;
  assigned_locations: string[];
}

const initialForm = (programs: string[]): InviteForm => ({
  email: '',
  can_place_orders: programs.includes('MANUFACTURING'),
  can_book_roaster: false,
  can_manage_locations: false,
  can_invite_users: false,
  location_access: 'ALL',
  assigned_locations: [],
});

export function InviteUserDialog({ open, onOpenChange, accountId, programs }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<InviteForm>(initialForm(programs));
  const { data: locations = [] } = useAccountLocations(accountId);

  const hasManufacturing = programs.includes('MANUFACTURING');
  const hasCoroasting = programs.includes('COROASTING');

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmed = form.email.trim();
      if (!trimmed) throw new Error('Email is required');

      const { data, error } = await supabase.functions.invoke('owner-invite-user', {
        body: {
          email: trimmed,
          account_id: accountId,
          can_place_orders: form.can_place_orders,
          can_book_roaster: form.can_book_roaster,
          can_manage_locations: form.can_manage_locations,
          can_invite_users: form.can_invite_users,
          location_access: form.location_access,
          assigned_locations: form.location_access === 'ASSIGNED' ? form.assigned_locations : [],
        },
      });

      // supabase-js returns FunctionsHttpError on non-2xx; surface server message
      if (error) {
        // Try to extract { error: '...' } body shape
        const body = (data ?? (error as unknown as { context?: { body?: string } })?.context?.body) as
          | { error?: string }
          | string
          | undefined;
        let msg: string | undefined;
        if (typeof body === 'string') {
          try { msg = (JSON.parse(body) as { error?: string }).error; } catch { msg = body; }
        } else if (body && typeof body === 'object') {
          msg = body.error;
        }
        throw new Error(msg || error.message || 'Invitation failed');
      }

      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }
      return data;
    },
    onSuccess: (data: { message?: string } | null | undefined) => {
      toast.success(data?.message || 'Invitation sent');
      queryClient.invalidateQueries({ queryKey: ['account-team', accountId] });
      setForm(initialForm(programs));
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleAssigned = (id: string, checked: boolean) => {
    setForm((f) => ({
      ...f,
      assigned_locations: checked
        ? [...f.assigned_locations, id]
        : f.assigned_locations.filter((x) => x !== id),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setForm(initialForm(programs)); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1">
            <Label>Email address</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="teammate@company.com"
            />
            <p className="text-xs text-muted-foreground">
              An invitation email will be sent. The user sets their own password.
            </p>
          </div>

          <div>
            <Label className="mb-2 block">Permissions</Label>
            <div className="grid grid-cols-1 gap-2">
              {hasManufacturing && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.can_place_orders}
                    onCheckedChange={(v) => setForm({ ...form, can_place_orders: !!v })}
                  />
                  Place orders
                </label>
              )}
              {hasCoroasting && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.can_book_roaster}
                    onCheckedChange={(v) => setForm({ ...form, can_book_roaster: !!v })}
                  />
                  Book roaster
                </label>
              )}
              {hasManufacturing && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.can_manage_locations}
                    onCheckedChange={(v) => setForm({ ...form, can_manage_locations: !!v })}
                  />
                  Manage locations
                </label>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.can_invite_users}
                  onCheckedChange={(v) => setForm({ ...form, can_invite_users: !!v })}
                />
                Invite team members
              </label>
            </div>
          </div>

          {hasManufacturing && (
            <div>
              <Label>Location access</Label>
              <Select
                value={form.location_access}
                onValueChange={(v) => setForm({ ...form, location_access: v })}
              >
                <SelectTrigger className="w-48 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Locations</SelectItem>
                  <SelectItem value="ASSIGNED">Assigned Only</SelectItem>
                </SelectContent>
              </Select>

              {form.location_access === 'ASSIGNED' && (
                <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-border">
                  <Label className="text-xs text-muted-foreground">Assigned locations</Label>
                  {locations.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No locations exist yet.</p>
                  ) : (
                    locations.map((loc) => (
                      <label key={loc.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={form.assigned_locations.includes(loc.id)}
                          onCheckedChange={(v) => toggleAssigned(loc.id, !!v)}
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
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.email.trim()}>
            {mutation.isPending ? 'Sending…' : 'Send Invitation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
