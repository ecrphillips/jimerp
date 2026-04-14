import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ArrowLeft, Info, CalendarIcon, Plus, Pencil, CheckCircle2, ExternalLink, ShieldCheck, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';

// ─── Profile Tab ───────────────────────────────────────────────
function ProfileTab({ account, refetch }: { account: any; refetch: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...account });

  // Account code editing (only when not yet set)
  const [accountCodeInput, setAccountCodeInput] = useState('');
  const [savingCode, setSavingCode] = useState(false);

  const { data: prospect } = useQuery({
    queryKey: ['account-prospect', account.relationship_id],
    queryFn: async () => {
      if (!account.relationship_id) return null;
      const { data } = await supabase
        .from('prospects')
        .select('id, business_name')
        .eq('id', account.relationship_id)
        .maybeSingle();
      return data;
    },
    enabled: !!account.relationship_id,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const programs: string[] = [];
      if (form.programs?.includes('MANUFACTURING')) programs.push('MANUFACTURING');
      if (form.programs?.includes('COROASTING')) programs.push('COROASTING');

      const payload: Record<string, unknown> = {
        account_name: form.account_name,
        billing_contact_name: form.billing_contact_name || null,
        billing_email: form.billing_email || null,
        billing_phone: form.billing_phone || null,
        billing_address: form.billing_address || null,
        notes_internal: form.notes_internal || null,
        is_active: form.is_active,
        programs,
      };

      if (programs.includes('COROASTING')) {
        payload.coroast_tier = form.coroast_tier;
        payload.coroast_joined_date = form.coroast_joined_date;
        payload.coroast_certified = form.coroast_certified;
        payload.coroast_certified_date = form.coroast_certified_date || null;
        payload.coroast_certified_by = form.coroast_certified_by || null;
      }

      const { error } = await supabase.from('accounts').update(payload as any).eq('id', account.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-detail'] });
      toast.success('Account updated');
      setEditing(false);
      refetch();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleProgram = (prog: string) => {
    const progs = form.programs || [];
    if (progs.includes(prog)) {
      setForm({ ...form, programs: progs.filter((p: string) => p !== prog) });
    } else {
      setForm({ ...form, programs: [...progs, prog] });
    }
  };

  if (!editing) {
    return (
      <div className="space-y-6">
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => { setForm({ ...account }); setEditing(true); }}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
          </Button>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-sm">Company Information</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div><span className="text-muted-foreground">Account Name</span><p className="font-medium">{account.account_name}</p></div>
            <div><span className="text-muted-foreground">Status</span><p>{account.is_active ? <Badge variant="outline" className="text-green-600 border-green-500">Active</Badge> : <Badge variant="destructive">Inactive</Badge>}</p></div>
            <div>
              <span className="text-muted-foreground">Account Code</span>
              {account.account_code ? (
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono font-medium text-sm bg-muted px-2 py-0.5 rounded">{account.account_code}</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" /> Cannot be changed after creation</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-0.5">
                  <Input
                    value={accountCodeInput}
                    onChange={e => setAccountCodeInput(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))}
                    placeholder="ABC"
                    className="w-20 font-mono text-sm h-8"
                    maxLength={3}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={accountCodeInput.length !== 3 || savingCode}
                    onClick={async () => {
                      setSavingCode(true);
                      try {
                        // Check uniqueness
                        const { data: existing } = await supabase
                          .from('accounts')
                          .select('id')
                          .eq('account_code', accountCodeInput)
                          .neq('id', account.id)
                          .maybeSingle();
                        if (existing) {
                          toast.error(`Code "${accountCodeInput}" is already in use`);
                          return;
                        }
                        const { error } = await supabase.from('accounts').update({ account_code: accountCodeInput } as any).eq('id', account.id);
                        if (error) throw error;
                        toast.success('Account code saved');
                        queryClient.invalidateQueries({ queryKey: ['account-detail'] });
                        refetch();
                      } catch (err: any) {
                        toast.error(err.message);
                      } finally {
                        setSavingCode(false);
                      }
                    }}
                  >
                    {savingCode ? '…' : 'Save'}
                  </Button>
                  <span className="text-xs text-muted-foreground">3 uppercase letters. Used for SKU generation. Locked after save.</span>
                </div>
              )}
            </div>
            <div><span className="text-muted-foreground">Billing Contact</span><p>{account.billing_contact_name || '—'}</p></div>
            <div><span className="text-muted-foreground">Billing Email</span><p>{account.billing_email || '—'}</p></div>
            <div><span className="text-muted-foreground">Billing Phone</span><p>{account.billing_phone || '—'}</p></div>
            <div><span className="text-muted-foreground">Billing Address</span><p className="whitespace-pre-wrap">{account.billing_address || '—'}</p></div>
            <div className="col-span-2"><span className="text-muted-foreground">Internal Notes</span><p className="whitespace-pre-wrap">{account.notes_internal || '—'}</p></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Programs</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex gap-2">
              {account.programs?.includes('MANUFACTURING') && (
                <Badge variant="outline" className="border-blue-500 text-blue-600">Manufacturing</Badge>
              )}
              {account.programs?.includes('COROASTING') && (
                <Badge variant="outline" className="border-amber-500 text-amber-600">Co-Roasting</Badge>
              )}
              {(!account.programs || account.programs.length === 0) && <span className="text-muted-foreground">No programs</span>}
            </div>
            {account.programs?.includes('COROASTING') && (
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 pt-2 border-t">
                <div><span className="text-muted-foreground">Tier</span><p><Badge variant="secondary">{account.coroast_tier || '—'}</Badge></p></div>
                <div><span className="text-muted-foreground">Joined</span><p>{account.coroast_joined_date || '—'}</p></div>
                <div><span className="text-muted-foreground">Certified</span><p>{account.coroast_certified ? <Badge className="bg-green-600 hover:bg-green-700"><CheckCircle2 className="h-3 w-3 mr-0.5" /> Yes</Badge> : 'No'}</p></div>
                {account.coroast_certified && (
                  <>
                    <div><span className="text-muted-foreground">Certified Date</span><p>{account.coroast_certified_date || '—'}</p></div>
                    <div><span className="text-muted-foreground">Certified By</span><p>{account.coroast_certified_by || '—'}</p></div>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {prospect && (
          <Card>
            <CardContent className="py-3 flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Converted from:</span>
              <Link to={`/prospects/${prospect.id}`} className="text-primary hover:underline flex items-center gap-1">
                {prospect.business_name} <ExternalLink className="h-3 w-3" />
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Edit mode
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-sm">Company Information</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Account name *</Label>
              <Input value={form.account_name} onChange={e => setForm({ ...form, account_name: e.target.value })} />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} />
              <Label>Active</Label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Billing contact</Label><Input value={form.billing_contact_name || ''} onChange={e => setForm({ ...form, billing_contact_name: e.target.value })} /></div>
            <div><Label>Billing email</Label><Input value={form.billing_email || ''} onChange={e => setForm({ ...form, billing_email: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Billing phone</Label><Input value={form.billing_phone || ''} onChange={e => setForm({ ...form, billing_phone: e.target.value })} /></div>
          </div>
          <div><Label>Billing address</Label><Textarea rows={2} value={form.billing_address || ''} onChange={e => setForm({ ...form, billing_address: e.target.value })} /></div>
          <div><Label>Internal notes</Label><Textarea rows={2} value={form.notes_internal || ''} onChange={e => setForm({ ...form, notes_internal: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">Programs</CardTitle>
            <Tooltip>
              <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
              <TooltipContent className="text-xs max-w-xs">Account name in JIM must match the customer name exactly as it appears in QuickBooks Online.</TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.programs?.includes('MANUFACTURING')} onCheckedChange={() => toggleProgram('MANUFACTURING')} />
              Manufacturing
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.programs?.includes('COROASTING')} onCheckedChange={() => toggleProgram('COROASTING')} />
              Co-Roasting
            </label>
          </div>
          {form.programs?.includes('COROASTING') && (
            <div className="space-y-3 pl-3 border-l-2 border-amber-300">
              <div className="flex items-center gap-2">
                <Label>Tier</Label>
                <Tooltip>
                  <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs text-xs">
                    Member: $399/mo, 3 included hours, 4-week booking horizon. Growth: $859/mo, 7 included hours, unlimited booking horizon + recurring blocks. Production: $1,399/mo, 12 included hours, unlimited booking horizon + recurring blocks.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Select value={form.coroast_tier || 'MEMBER'} onValueChange={v => setForm({ ...form, coroast_tier: v })}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEMBER">Member</SelectItem>
                  <SelectItem value="GROWTH">Growth</SelectItem>
                  <SelectItem value="PRODUCTION">Production</SelectItem>
                </SelectContent>
              </Select>
              <div>
                <Label>Joined date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-40 justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {form.coroast_joined_date ? format(new Date(form.coroast_joined_date + 'T00:00'), 'PP') : 'Pick date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={form.coroast_joined_date ? new Date(form.coroast_joined_date + 'T00:00') : undefined}
                      onSelect={(d) => d && setForm({ ...form, coroast_joined_date: format(d, 'yyyy-MM-dd') })}
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.coroast_certified} onCheckedChange={v => setForm({ ...form, coroast_certified: v })} />
                <Label>Certified</Label>
              </div>
              {form.coroast_certified && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Certified date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal text-sm">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {form.coroast_certified_date ? format(new Date(form.coroast_certified_date + 'T00:00'), 'PP') : 'Pick'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={form.coroast_certified_date ? new Date(form.coroast_certified_date + 'T00:00') : undefined}
                          onSelect={(d) => d && setForm({ ...form, coroast_certified_date: format(d, 'yyyy-MM-dd') })}
                          className="p-3 pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div><Label>Certified by</Label><Input value={form.coroast_certified_by || ''} onChange={e => setForm({ ...form, coroast_certified_by: e.target.value })} /></div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
        <Button onClick={() => saveMutation.mutate()} disabled={!form.account_name?.trim() || saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}

// ─── Locations Tab ─────────────────────────────────────────────
function LocationsTab({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ location_name: '', location_code: '', address: '', qbo_billing_entity: '', is_active: true });

  const { data: locations = [] } = useQuery({
    queryKey: ['account-locations', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('account_locations')
        .select('*')
        .eq('account_id', accountId)
        .order('location_code');
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { ...form, account_id: accountId };
      if (editId) {
        const { error } = await supabase.from('account_locations').update(payload).eq('id', editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('account_locations').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-locations'] });
      toast.success(editId ? 'Location updated' : 'Location added');
      resetForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetForm = () => {
    setShowAdd(false);
    setEditId(null);
    setForm({ location_name: '', location_code: '', address: '', qbo_billing_entity: '', is_active: true });
  };

  const startEdit = (loc: any) => {
    setEditId(loc.id);
    setForm({ location_name: loc.location_name, location_code: loc.location_code, address: loc.address || '', qbo_billing_entity: loc.qbo_billing_entity || '', is_active: loc.is_active });
    setShowAdd(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Locations</h3>
        <Button size="sm" onClick={() => { resetForm(); setShowAdd(true); }}><Plus className="h-3.5 w-3.5 mr-1" /> Add Location</Button>
      </div>

      {locations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No locations yet.</p>
      ) : (
        <div className="border rounded-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Code</th>
                <th className="text-left px-3 py-2 font-medium">QBO Entity</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {locations.map((loc: any) => (
                <tr key={loc.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{loc.location_name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{loc.location_code}</td>
                  <td className="px-3 py-2 text-muted-foreground">{loc.qbo_billing_entity || '—'}</td>
                  <td className="px-3 py-2">{loc.is_active ? <Badge variant="outline" className="text-green-600 border-green-500 text-[10px]">Active</Badge> : <Badge variant="destructive" className="text-[10px]">Inactive</Badge>}</td>
                  <td className="px-3 py-2"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(loc)}><Pencil className="h-3 w-3" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={open => { if (!open) resetForm(); setShowAdd(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editId ? 'Edit Location' : 'Add Location'}</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div><Label>Location name *</Label><Input value={form.location_name} onChange={e => setForm({ ...form, location_name: e.target.value })} /></div>
            <div>
              <div className="flex items-center gap-2">
                <Label>Location code *</Label>
                <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent className="text-xs max-w-xs">Short internal code used to identify this location on orders and reports. E.g. 'VAN-01', 'KITS'.</TooltipContent></Tooltip>
              </div>
              <Input value={form.location_code} onChange={e => setForm({ ...form, location_code: e.target.value.toUpperCase() })} className="font-mono" />
            </div>
            <div><Label>Address</Label><Textarea rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
            <div>
              <div className="flex items-center gap-2">
                <Label>QBO Billing Entity *</Label>
                <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent className="text-xs max-w-xs">Enter the customer name exactly as it appears in QuickBooks Online for this location. Orders from this location will be invoiced to this QBO account.</TooltipContent></Tooltip>
              </div>
              <Input value={form.qbo_billing_entity} onChange={e => setForm({ ...form, qbo_billing_entity: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} />
              <Label>Active</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            <Button variant="outline" onClick={resetForm}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!form.location_name.trim() || !form.location_code.trim() || saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : editId ? 'Update' : 'Add'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Users Tab ─────────────────────────────────────────────────
function UsersTab({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const { authUser } = useAuth();
  const [showInvite, setShowInvite] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: '', is_owner: false, can_place_orders: true, can_book_roaster: false,
    can_manage_locations: false, can_invite_users: false, location_access: 'ALL' as string,
    assigned_locations: [] as string[],
  });

  const { data: users = [] } = useQuery({
    queryKey: ['account-users', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('account_users')
        .select('*, profiles:user_id(name, email)')
        .eq('account_id', accountId)
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['account-locations', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('account_locations')
        .select('id, location_name, location_code')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .order('location_code');
      if (error) throw error;
      return data;
    },
  });

  const { data: userLocations = [] } = useQuery({
    queryKey: ['account-user-locations', editId],
    queryFn: async () => {
      if (!editId) return [];
      const { data, error } = await supabase
        .from('account_user_locations')
        .select('location_id')
        .eq('account_user_id', editId);
      if (error) throw error;
      return data.map((d: any) => d.location_id);
    },
    enabled: !!editId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editId) {
        const { error } = await supabase.from('account_users').update({
          is_owner: form.is_owner,
          can_place_orders: form.can_place_orders,
          can_book_roaster: form.can_book_roaster,
          can_manage_locations: form.can_manage_locations,
          can_invite_users: form.can_invite_users,
          location_access: form.location_access,
        }).eq('id', editId);
        if (error) throw error;

        // Update location assignments
        await supabase.from('account_user_locations').delete().eq('account_user_id', editId);
        if (form.location_access === 'ASSIGNED' && form.assigned_locations.length > 0) {
          const { error: locError } = await supabase.from('account_user_locations').insert(
            form.assigned_locations.map(lid => ({ account_user_id: editId, location_id: lid }))
          );
          if (locError) throw locError;
        }
      } else {
        // Call invite-account-user edge function
        const { data, error: fnError } = await supabase.functions.invoke('invite-account-user', {
          body: {
            email: form.email,
            account_id: accountId,
            is_owner: form.is_owner,
            can_place_orders: form.can_place_orders,
            can_book_roaster: form.can_book_roaster,
            can_manage_locations: form.can_manage_locations,
            can_invite_users: form.can_invite_users,
            location_access: form.location_access,
            assigned_locations: form.location_access === 'ASSIGNED' ? form.assigned_locations : [],
          },
        });
        if (fnError) throw new Error(fnError.message || 'Failed to invite user');
        if (data?.error) throw new Error(data.error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-users'] });
      queryClient.invalidateQueries({ queryKey: ['account-user-locations'] });
      toast.success(editId ? 'User updated' : `Invitation sent to ${form.email}`);
      resetForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetForm = () => {
    setShowInvite(false);
    setEditId(null);
    setForm({ email: '', is_owner: false, can_place_orders: true, can_book_roaster: false, can_manage_locations: false, can_invite_users: false, location_access: 'ALL', assigned_locations: [] });
  };

  const startEdit = (user: any) => {
    setEditId(user.id);
    setForm({
      email: '',
      is_owner: user.is_owner,
      can_place_orders: user.can_place_orders,
      can_book_roaster: user.can_book_roaster,
      can_manage_locations: user.can_manage_locations,
      can_invite_users: user.can_invite_users,
      location_access: user.location_access,
      assigned_locations: [],
    });
    setShowInvite(true);
  };

  // Load assigned locations into form when editing
  React.useEffect(() => {
    if (editId && userLocations.length > 0) {
      setForm(f => ({ ...f, assigned_locations: userLocations as string[] }));
    }
  }, [editId, userLocations]);

  const permBadges = (u: any) => {
    const badges: { label: string; active: boolean }[] = [
      { label: 'Orders', active: u.can_place_orders },
      { label: 'Roaster', active: u.can_book_roaster },
      { label: 'Locations', active: u.can_manage_locations },
      { label: 'Invite', active: u.can_invite_users },
    ];
    return badges.filter(b => b.active).map(b => (
      <Badge key={b.label} variant="secondary" className="text-[10px]">{b.label}</Badge>
    ));
  };

  const isOnlyOwner = (userId: string) => {
    const owners = users.filter((u: any) => u.is_owner);
    return owners.length <= 1 && owners[0]?.id === userId;
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Users</h3>
        <Button size="sm" onClick={() => { resetForm(); setShowInvite(true); }}><Plus className="h-3.5 w-3.5 mr-1" /> Invite User</Button>
      </div>

      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users linked to this account.</p>
      ) : (
        <div className="space-y-2">
          {users.map((u: any) => {
            const profile = u.profiles;
            return (
              <div key={u.id} className="flex items-center gap-3 border rounded-md p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{profile?.name || 'Unknown'}</span>
                    <span className="text-xs text-muted-foreground">{profile?.email}</span>
                    {u.is_owner && <Badge className="text-[10px] bg-primary"><ShieldCheck className="h-3 w-3 mr-0.5" /> Owner</Badge>}
                    {!u.is_active && <Badge variant="destructive" className="text-[10px]">Inactive</Badge>}
                  </div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {permBadges(u)}
                    <Badge variant="outline" className="text-[10px]">{u.location_access === 'ALL' ? 'All Locations' : 'Assigned Only'}</Badge>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(u)}><Pencil className="h-3 w-3" /></Button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showInvite} onOpenChange={open => { if (!open) resetForm(); setShowInvite(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editId ? 'Edit User' : 'Invite User'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            {!editId && (
              <div>
                <div className="flex items-center gap-2">
                  <Label>Email address</Label>
                  <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent className="text-xs max-w-xs">An invitation will be sent to this email. The user must not already have an account in the system.</TooltipContent></Tooltip>
                </div>
                <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
            )}

            <div className="flex items-center gap-2">
              {editId && isOnlyOwner(editId) ? (
                <Tooltip>
                  <TooltipTrigger className="flex items-center gap-2">
                    <Switch checked disabled />
                    <Label className="text-muted-foreground">Owner</Label>
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="text-xs max-w-xs">An account must have at least one Owner. To remove this user as Owner, first assign another user as Owner.</TooltipContent>
                </Tooltip>
              ) : (
                <>
                  <Switch checked={form.is_owner} onCheckedChange={v => setForm({ ...form, is_owner: v })} />
                  <Label>Owner</Label>
                  <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent className="text-xs max-w-xs">Owners have full access to all account functions and can manage other users. Each account should have at least one Owner.</TooltipContent></Tooltip>
                </>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Label>Permissions</Label>
                <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent className="text-xs max-w-xs">These permissions control what this user can do within the account portal. The account Owner can adjust these at any time.</TooltipContent></Tooltip>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.can_place_orders} onCheckedChange={v => setForm({ ...form, can_place_orders: !!v })} /> Place orders</label>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.can_book_roaster} onCheckedChange={v => setForm({ ...form, can_book_roaster: !!v })} /> Book roaster</label>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.can_manage_locations} onCheckedChange={v => setForm({ ...form, can_manage_locations: !!v })} /> Manage locations</label>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.can_invite_users} onCheckedChange={v => setForm({ ...form, can_invite_users: !!v })} /> Invite users</label>
              </div>
            </div>

            <div>
              <Label>Location access</Label>
              <Select value={form.location_access} onValueChange={v => setForm({ ...form, location_access: v })}>
                <SelectTrigger className="w-48 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Locations</SelectItem>
                  <SelectItem value="ASSIGNED">Assigned Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.location_access === 'ASSIGNED' && locations.length > 0 && (
              <div className="space-y-1.5 pl-2 border-l-2 border-border">
                <Label className="text-xs text-muted-foreground">Assigned locations</Label>
                {locations.map((loc: any) => (
                  <label key={loc.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.assigned_locations.includes(loc.id)}
                      onCheckedChange={(v) => {
                        if (v) setForm({ ...form, assigned_locations: [...form.assigned_locations, loc.id] });
                        else setForm({ ...form, assigned_locations: form.assigned_locations.filter(id => id !== loc.id) });
                      }}
                    />
                    {loc.location_name} <span className="text-muted-foreground font-mono text-xs">({loc.location_code})</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            <Button variant="outline" onClick={resetForm}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : editId ? 'Update' : 'Send Invite'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Co-Roasting Tab ───────────────────────────────────────────
const CHECKLIST_ITEMS = [
  'Member Agreement signed',
  'Certificate of Insurance on file (minimum $5M per occurrence)',
  'WCB Coverage confirmation on file',
  'Equipment orientation session completed (min 2 hours, conducted by Home Island Coffee Partners staff)',
  'Roast proficiency demonstrated and signed off by Home Island Coffee Partners staff',
  'Facility safety walkthrough completed (fire suppression, emergency shut-off, first aid)',
  'Supervised roast session completed to Home Island Coffee Partners satisfaction',
];

const QBO_SUB_FIELDS = [
  { key: 'qbo_company_name' as const, label: 'Registered company name confirmed' },
  { key: 'qbo_billing_contact' as const, label: 'Billing contact name, email, and phone on file' },
  { key: 'qbo_billing_address' as const, label: 'Billing address on file' },
  { key: 'qbo_credit_card' as const, label: 'Credit card on file' },
];

const CHECKLIST_TOOLTIPS: Record<number, string> = {
  1: 'PSA: our member agreement says $2M but we have updated our standard to $5M.',
};

function CoRoastingTab({ account, refetch }: { account: any; refetch: () => void }) {
  const queryClient = useQueryClient();

  const TOTAL_ORIGINAL_ITEMS = 7;

  const { data: checklist = [] } = useQuery({
    queryKey: ['account-checklist', account.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_member_checklist')
        .select('*')
        .eq('account_id', account.id)
        .order('item_number');
      if (error) throw error;
      return data;
    },
  });

  // Read QBO sub-fields from the first checklist row (they're stored on every row but we use item 1)
  const qboRow = checklist[0] as any | undefined;
  const qboSubs = {
    qbo_company_name: qboRow?.qbo_company_name || false,
    qbo_billing_contact: qboRow?.qbo_billing_contact || false,
    qbo_billing_address: qboRow?.qbo_billing_address || false,
    qbo_credit_card: qboRow?.qbo_credit_card || false,
  };
  const qboParentChecked = QBO_SUB_FIELDS.every(f => qboSubs[f.key]);

  const recomputeCertification = async (allOriginalComplete: boolean, allQboComplete: boolean) => {
    const allComplete = allOriginalComplete && allQboComplete;

    const update: Record<string, unknown> = { coroast_certified: allComplete };
    if (allComplete && !account.coroast_certified) {
      update.coroast_certified_date = new Date().toISOString().split('T')[0];
    }
    if (!allComplete) {
      update.coroast_certified_date = null;
      update.coroast_certified_by = null;
    }
    await supabase.from('accounts').update(update).eq('id', account.id);
  };

  const toggleItem = useMutation({
    mutationFn: async ({ itemNumber, completed }: { itemNumber: number; completed: boolean }) => {
      const existing = checklist.find((c: any) => c.item_number === itemNumber);
      if (existing) {
        const { error } = await supabase.from('coroast_member_checklist').update({
          completed,
          completed_date: completed ? new Date().toISOString().split('T')[0] : null,
        }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('coroast_member_checklist').insert({
          account_id: account.id,
          item_number: itemNumber,
          completed,
          completed_date: completed ? new Date().toISOString().split('T')[0] : null,
        } as any);
        if (error) throw error;
      }

      const allItems = [...checklist.filter((c: any) => c.item_number !== itemNumber), { item_number: itemNumber, completed }];
      const allOriginalComplete = Array.from({ length: TOTAL_ORIGINAL_ITEMS }, (_, i) => {
        const item = allItems.find((c: any) => c.item_number === i + 1);
        return item?.completed;
      }).every(Boolean);
      await recomputeCertification(allOriginalComplete, qboParentChecked);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-checklist'] });
      queryClient.invalidateQueries({ queryKey: ['account-detail'] });
      refetch();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleQboSub = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: boolean }) => {
      const newSubs = { ...qboSubs, [field]: value };
      const allSubsChecked = QBO_SUB_FIELDS.every(f => newSubs[f.key]);

      const payload = { [field]: value };

      if (qboRow) {
        // Update the first checklist row with QBO fields
        const { error } = await supabase.from('coroast_member_checklist').update(payload).eq('id', qboRow.id);
        if (error) throw error;
      } else {
        // No checklist rows exist yet — create item 1 with the QBO field
        const { error } = await supabase.from('coroast_member_checklist').insert({
          account_id: account.id,
          item_number: 1,
          completed: false,
          ...newSubs,
        } as any);
        if (error) throw error;
      }

      const allOriginalComplete = Array.from({ length: TOTAL_ORIGINAL_ITEMS }, (_, i) => {
        const item = checklist.find((c: any) => c.item_number === i + 1);
        return item?.completed || false;
      }).every(Boolean);
      await recomputeCertification(allOriginalComplete, allSubsChecked);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-checklist'] });
      queryClient.invalidateQueries({ queryKey: ['account-detail'] });
      refetch();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const getItemChecked = (index: number) => {
    const item = checklist.find((c: any) => c.item_number === index + 1);
    return item?.completed || false;
  };

  return (
    <div className="space-y-6">
      {account.coroast_certified && (
        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <span className="text-sm font-medium text-green-700 dark:text-green-400">Certified — All checklist items complete</span>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Certification Checklist</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {CHECKLIST_ITEMS.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <Checkbox
                checked={getItemChecked(i)}
                onCheckedChange={(v) => toggleItem.mutate({ itemNumber: i + 1, completed: !!v })}
                className="mt-0.5"
              />
              <span className="text-sm flex-1">{item}</span>
              {CHECKLIST_TOOLTIPS[i] && (
                <Tooltip>
                  <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" /></TooltipTrigger>
                  <TooltipContent className="text-xs max-w-xs">{CHECKLIST_TOOLTIPS[i]}</TooltipContent>
                </Tooltip>
              )}
            </div>
          ))}

          {/* QBO parent item */}
          <div className="flex items-start gap-2 pt-1">
            <Checkbox
              checked={qboParentChecked}
              disabled
              className="mt-0.5"
            />
            <span className="text-sm flex-1 font-medium">Client account active in QBO</span>
          </div>

          {/* QBO sub-checkboxes */}
          {QBO_SUB_FIELDS.map((sub) => (
            <div key={sub.key} className="flex items-start gap-2 pl-6">
              <Checkbox
                checked={qboSubs[sub.key] || false}
                onCheckedChange={(v) => toggleQboSub.mutate({ field: sub.key, value: !!v })}
                className="mt-0.5"
              />
              <span className="text-xs text-muted-foreground flex-1">{sub.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Bookings & Billing</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Booking history and billing will display here.</p>
        </CardContent>
      </Card>

      <CustomRateOverrides account={account} refetch={refetch} />
    </div>
  );
}

// ─── Custom Rate Overrides (Admin only, COROASTING accounts) ───
const OVERRIDE_FIELDS = [
  { key: 'coroast_custom_base_fee', label: 'Base Fee ($/month)', tierKey: 'base' },
  { key: 'coroast_custom_included_hours', label: 'Included Hours', tierKey: 'includedHours' },
  { key: 'coroast_custom_overage_rate', label: 'Overage Rate ($/hr)', tierKey: 'overageRate' },
  { key: 'coroast_custom_included_pallets', label: 'Included Pallets', tierKey: 'includedPallets' },
  { key: 'coroast_custom_storage_rate', label: 'Storage Rate ($/pallet/mo)', tierKey: 'storageRate' },
] as const;

const TIER_DEFAULTS: Record<string, Record<string, number>> = {
  MEMBER: { base: 399, includedHours: 3, overageRate: 160, includedPallets: 0, storageRate: 175 },
  GROWTH: { base: 859, includedHours: 7, overageRate: 145, includedPallets: 1, storageRate: 175 },
  PRODUCTION: { base: 1399, includedHours: 12, overageRate: 130, includedPallets: 2, storageRate: 175 },
};

function CustomRateOverrides({ account, refetch }: { account: any; refetch: () => void }) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const isAdmin = authUser?.role === 'ADMIN';
  const hasCoroasting = account.programs?.includes('COROASTING');

  if (!isAdmin || !hasCoroasting) return null;

  const tier = account.coroast_tier ?? 'MEMBER';
  const tierDefaults = TIER_DEFAULTS[tier] ?? TIER_DEFAULTS.MEMBER;

  const startEdit = () => {
    const f: Record<string, string> = {};
    for (const field of OVERRIDE_FIELDS) {
      const val = account[field.key];
      f[field.key] = val != null ? String(val) : '';
    }
    setForm(f);
    setEditing(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, number | null> = {};
      for (const field of OVERRIDE_FIELDS) {
        const raw = form[field.key]?.trim();
        payload[field.key] = raw ? Number(raw) : null;
      }
      const { error } = await supabase.from('accounts').update(payload as any).eq('id', account.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-detail'] });
      toast.success('Rate overrides saved');
      setEditing(false);
      refetch();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Custom Rate Overrides</CardTitle>
          {!editing && (
            <Button variant="ghost" size="sm" onClick={startEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <>
            {OVERRIDE_FIELDS.map((field) => (
              <div key={field.key}>
                <Label className="text-xs">{field.label}</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder={`Tier default: $${tierDefaults[field.tierKey]}`}
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Leave blank to use the tier default.</p>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : 'Save Overrides'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </>
        ) : (
          <div className="space-y-1 text-sm">
            {OVERRIDE_FIELDS.map((field) => {
              const val = account[field.key];
              return (
                <div key={field.key} className="flex justify-between">
                  <span className="text-muted-foreground">{field.label}</span>
                  <span className={val != null ? 'font-medium' : 'text-muted-foreground'}>
                    {val != null ? `$${Number(val).toLocaleString()}` : `Tier default ($${tierDefaults[field.tierKey]})`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Detail Page ──────────────────────────────────────────
export default function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: account, isLoading, refetch } = useQuery({
    queryKey: ['account-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="page-container space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="page-container">
        <p className="text-muted-foreground">Account not found.</p>
        <Button variant="link" onClick={() => navigate('/accounts')}>← Back to Accounts</Button>
      </div>
    );
  }

  const hasManufacturing = account.programs?.includes('MANUFACTURING');
  const hasCoroasting = account.programs?.includes('COROASTING');

  return (
    <div className="page-container">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/accounts')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-bold">{account.account_name}</h1>
          {hasManufacturing && <Badge variant="outline" className="border-blue-500 text-blue-600">Manufacturing</Badge>}
          {hasCoroasting && <Badge variant="outline" className="border-amber-500 text-amber-600">Co-Roasting</Badge>}
          {!account.is_active && <Badge variant="destructive">Inactive</Badge>}
        </div>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {hasManufacturing && <TabsTrigger value="locations">Locations</TabsTrigger>}
          <TabsTrigger value="users">Users</TabsTrigger>
          {hasCoroasting && <TabsTrigger value="coroasting">Co-Roasting</TabsTrigger>}
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="profile">
            <ProfileTab account={account} refetch={refetch} />
          </TabsContent>
          {hasManufacturing && (
            <TabsContent value="locations">
              <LocationsTab accountId={account.id} />
            </TabsContent>
          )}
          <TabsContent value="users">
            <UsersTab accountId={account.id} />
          </TabsContent>
          {hasCoroasting && (
            <TabsContent value="coroasting">
              <CoRoastingTab account={account} refetch={refetch} />
            </TabsContent>
          )}
          <TabsContent value="activity">
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Full activity log coming soon.
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
