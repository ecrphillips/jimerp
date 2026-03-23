import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Search, Info, CalendarIcon, Building2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

type ProgramFilter = 'ALL' | 'MANUFACTURING' | 'COROASTING' | 'BOTH';

interface AccountRow {
  id: string;
  account_name: string;
  account_code: string | null;
  billing_contact_name: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_address: string | null;
  notes_internal: string | null;
  is_active: boolean;
  programs: string[];
  coroast_tier: string | null;
  coroast_certified: boolean;
  coroast_joined_date: string | null;
  coroast_certified_date: string | null;
  coroast_certified_by: string | null;
  created_at: string;
}

export default function Accounts() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [programFilter, setProgramFilter] = useState<ProgramFilter>('ALL');
  const [showNewModal, setShowNewModal] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formContact, setFormContact] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formManufacturing, setFormManufacturing] = useState(false);
  const [formCoroasting, setFormCoroasting] = useState(false);
  const [formTier, setFormTier] = useState<string>('ACCESS');
  const [formJoinedDate, setFormJoinedDate] = useState<Date>(new Date());
  const [formCertified, setFormCertified] = useState(false);
  const [formCertifiedDate, setFormCertifiedDate] = useState<Date | undefined>(undefined);
  const [formCertifiedBy, setFormCertifiedBy] = useState('');

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('*, account_code')
        .order('account_name');
      if (error) throw error;
      return data as AccountRow[];
    },
  });

  const filtered = useMemo(() => {
    let list = accounts;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a => a.account_name.toLowerCase().includes(q));
    }
    if (programFilter === 'MANUFACTURING') {
      list = list.filter(a => a.programs.includes('MANUFACTURING'));
    } else if (programFilter === 'COROASTING') {
      list = list.filter(a => a.programs.includes('COROASTING'));
    } else if (programFilter === 'BOTH') {
      list = list.filter(a => a.programs.includes('MANUFACTURING') && a.programs.includes('COROASTING'));
    }
    return list;
  }, [accounts, search, programFilter]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const programs: string[] = [];
      if (formManufacturing) programs.push('MANUFACTURING');
      if (formCoroasting) programs.push('COROASTING');

      const payload: Record<string, unknown> = {
        account_name: formName.trim(),
        billing_contact_name: formContact || null,
        billing_email: formEmail || null,
        billing_phone: formPhone || null,
        billing_address: formAddress || null,
        notes_internal: formNotes || null,
        programs,
        is_active: true,
      };

      if (formCoroasting) {
        payload.coroast_tier = formTier;
        payload.coroast_joined_date = format(formJoinedDate, 'yyyy-MM-dd');
        payload.coroast_certified = formCertified;
        if (formCertified && formCertifiedDate) {
          payload.coroast_certified_date = format(formCertifiedDate, 'yyyy-MM-dd');
          payload.coroast_certified_by = formCertifiedBy || null;
        }
      }

      const { data, error } = await supabase
        .from('accounts')
        .insert(payload as any)
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Account created');
      setShowNewModal(false);
      resetForm();
      navigate(`/accounts/${data.id}`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const resetForm = () => {
    setFormName('');
    setFormContact('');
    setFormEmail('');
    setFormPhone('');
    setFormAddress('');
    setFormNotes('');
    setFormManufacturing(false);
    setFormCoroasting(false);
    setFormTier('ACCESS');
    setFormJoinedDate(new Date());
    setFormCertified(false);
    setFormCertifiedDate(undefined);
    setFormCertifiedBy('');
  };

  const canSave = formName.trim() && (formManufacturing || formCoroasting);

  const filterChips: { label: string; value: ProgramFilter }[] = [
    { label: 'All', value: 'ALL' },
    { label: 'Manufacturing', value: 'MANUFACTURING' },
    { label: 'Co-Roasting', value: 'COROASTING' },
    { label: 'Both', value: 'BOTH' },
  ];

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between">
        <h1 className="page-title">Accounts</h1>
        <Button onClick={() => setShowNewModal(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Account
        </Button>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search accounts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {filterChips.map(c => (
            <button
              key={c.value}
              onClick={() => setProgramFilter(c.value)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-colors border',
                programFilter === c.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-muted-foreground border-border hover:bg-accent'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Accounts list */}
      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">No accounts found.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(account => (
            <button
              key={account.id}
              onClick={() => navigate(`/accounts/${account.id}`)}
              className="w-full text-left rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors flex items-center gap-4"
            >
              <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                 <span className="font-medium text-sm">{account.account_name}</span>
                  {account.account_code && (
                    <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">{account.account_code}</span>
                  )}
                  {account.programs.includes('MANUFACTURING') && (
                    <Badge variant="outline" className="text-[10px] border-blue-500 text-blue-600">Manufacturing</Badge>
                  )}
                  {account.programs.includes('COROASTING') && (
                    <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600">Co-Roasting</Badge>
                  )}
                  {account.coroast_tier && (
                    <Badge variant="secondary" className="text-[10px]">{account.coroast_tier}</Badge>
                  )}
                  {account.coroast_certified && (
                    <Badge className="text-[10px] bg-green-600 hover:bg-green-700">
                      <CheckCircle2 className="h-3 w-3 mr-0.5" /> Certified
                    </Badge>
                  )}
                  {!account.is_active && (
                    <Badge variant="destructive" className="text-[10px]">Inactive</Badge>
                  )}
                </div>
                {(account.billing_contact_name || account.billing_email) && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {[account.billing_contact_name, account.billing_email].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* New Account Modal */}
      <Dialog open={showNewModal} onOpenChange={(open) => { setShowNewModal(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Account</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 pt-2">
            {/* Company Info */}
            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Company Info</h3>
              <div>
                <Label htmlFor="acct-name">Account name *</Label>
                <Input id="acct-name" value={formName} onChange={e => setFormName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="acct-contact">Billing contact</Label>
                  <Input id="acct-contact" value={formContact} onChange={e => setFormContact(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="acct-email">Billing email</Label>
                  <Input id="acct-email" type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="acct-phone">Billing phone</Label>
                  <Input id="acct-phone" value={formPhone} onChange={e => setFormPhone(e.target.value)} />
                </div>
              </div>
              <div>
                <Label htmlFor="acct-address">Billing address</Label>
                <Textarea id="acct-address" rows={2} value={formAddress} onChange={e => setFormAddress(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="acct-notes">Internal notes</Label>
                <Textarea id="acct-notes" rows={2} value={formNotes} onChange={e => setFormNotes(e.target.value)} />
              </div>
            </section>

            {/* Programs */}
            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Programs *</h3>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={formManufacturing} onCheckedChange={(v) => setFormManufacturing(!!v)} />
                  Manufacturing
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={formCoroasting} onCheckedChange={(v) => setFormCoroasting(!!v)} />
                  Co-Roasting
                </label>
              </div>

              {formCoroasting && (
                <div className="space-y-3 pl-2 border-l-2 border-amber-300 ml-1">
                  <div className="flex items-center gap-2">
                    <Label>Tier</Label>
                    <Tooltip>
                      <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs text-xs">
                        Access: $300/mo, 3 included hours, 4-week booking horizon. Growth: $1,000/mo, 10 included hours, unlimited booking horizon + recurring blocks.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Select value={formTier} onValueChange={setFormTier}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACCESS">Access</SelectItem>
                      <SelectItem value="GROWTH">Growth</SelectItem>
                    </SelectContent>
                  </Select>

                  <div>
                    <Label>Joined date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-40 justify-start text-left font-normal">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {format(formJoinedDate, 'PP')}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={formJoinedDate}
                          onSelect={(d) => d && setFormJoinedDate(d)}
                          className="p-3 pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              )}
            </section>

            {/* Certification */}
            {formCoroasting && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Certification</h3>
                  <Tooltip>
                    <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs text-xs">
                      Members must complete all 7 certification checklist items before being marked certified. Certification unlocks unsupervised equipment access.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={formCertified} onCheckedChange={setFormCertified} />
                  <Label>Certified</Label>
                </div>
                {formCertified && (
                  <div className="grid grid-cols-2 gap-3 pl-2 border-l-2 border-green-300 ml-1">
                    <div>
                      <Label>Certified date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start text-left font-normal text-sm">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {formCertifiedDate ? format(formCertifiedDate, 'PP') : 'Pick date'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={formCertifiedDate}
                            onSelect={setFormCertifiedDate}
                            className="p-3 pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div>
                      <Label>Certified by</Label>
                      <Input value={formCertifiedBy} onChange={e => setFormCertifiedBy(e.target.value)} />
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            <Button variant="outline" onClick={() => { setShowNewModal(false); resetForm(); }}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!canSave || createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create Account'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
