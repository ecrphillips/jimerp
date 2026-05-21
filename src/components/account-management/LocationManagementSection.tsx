import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ownerRpc } from './ownerRpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MapPin, Plus, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useAccountLocations } from '@/hooks/useAccountLocations';

interface Props {
  accountId: string;
  canManage: boolean;
}

interface LocationForm {
  location_name: string;
  location_code: string;
  address: string;
  bill_separately: boolean;
  qbo_billing_entity: string;
}

const initialForm: LocationForm = {
  location_name: '',
  location_code: '',
  address: '',
  bill_separately: false,
  qbo_billing_entity: '',
};

export function LocationManagementSection({ accountId, canManage }: Props) {
  const queryClient = useQueryClient();
  const { data: locations = [], isLoading } = useAccountLocations(accountId);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<LocationForm>(initialForm);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.location_name.trim()) throw new Error('Location name is required');
      if (!form.location_code.trim()) throw new Error('Location code is required');
      if (form.bill_separately && !form.qbo_billing_entity.trim()) {
        throw new Error('QuickBooks billing name is required when billing separately');
      }

      const { error } = await ownerRpc('owner_create_location', {
        p_account_id: accountId,
        p_location_name: form.location_name.trim(),
        p_location_code: form.location_code.trim(),
        p_address: form.address.trim() || null,
        p_qbo_billing_entity: form.bill_separately ? form.qbo_billing_entity.trim() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      const msg = form.bill_separately
        ? 'Location created. Our team will configure separate QuickBooks billing for it shortly.'
        : 'Location created';
      toast.success(msg);
      queryClient.invalidateQueries({ queryKey: ['account-locations', accountId] });
      setForm(initialForm);
      setShowCreate(false);
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create location'),
  });

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Locations</CardTitle>
          {canManage && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Location
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : locations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No locations yet.</p>
          ) : (
            <div className="space-y-2">
              {locations.map((loc) => (
                <div key={loc.id} className="flex items-start gap-3 border rounded-md p-3">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{loc.location_code}</span>
                      <span className="text-sm font-medium">{loc.location_name}</span>
                      {!loc.is_active && (
                        <span className="text-[10px] uppercase text-muted-foreground">Inactive</span>
                      )}
                    </div>
                    {loc.address && (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap mt-0.5">{loc.address}</p>
                    )}
                    {loc.qbo_billing_entity && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Billed separately as: <span className="font-medium">{loc.qbo_billing_entity}</span>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) setForm(initialForm); setShowCreate(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Location</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label>Location Name <span className="text-destructive">*</span></Label>
                <Input
                  value={form.location_name}
                  onChange={(e) => setForm({ ...form, location_name: e.target.value })}
                  placeholder="Downtown Cafe"
                />
              </div>
              <div className="space-y-1">
                <Label>Code <span className="text-destructive">*</span></Label>
                <Input
                  value={form.location_code}
                  onChange={(e) => setForm({ ...form, location_code: e.target.value.toUpperCase() })}
                  placeholder="DT01"
                  maxLength={10}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Address</Label>
              <Textarea
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>

            <div className="flex items-center justify-between border-t pt-3">
              <div>
                <Label>Bill this location separately?</Label>
                <p className="text-xs text-muted-foreground">
                  Off = billing rolls up to your main account.
                </p>
              </div>
              <Switch
                checked={form.bill_separately}
                onCheckedChange={(v) => setForm({ ...form, bill_separately: v })}
              />
            </div>

            {form.bill_separately && (
              <>
                <div className="space-y-1">
                  <Label>QuickBooks Billing Name <span className="text-destructive">*</span></Label>
                  <Input
                    value={form.qbo_billing_entity}
                    onChange={(e) => setForm({ ...form, qbo_billing_entity: e.target.value })}
                    placeholder="e.g. ACME Coffee — Downtown LLC"
                  />
                </div>
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Our team will set up a separate QuickBooks billing entry for this location.
                    Invoices for this location will be sent separately once it's configured.
                  </AlertDescription>
                </Alert>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreate(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create Location'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
