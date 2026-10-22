import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { defaultCommonClientIds, groupOrderClients, type OrderClient } from '@/lib/orderClientGroups';

const SETTINGS_KEY = 'order_common_client_shortcuts';
const QUERY_KEY = ['app_settings', SETTINGS_KEY] as const;

export function OrderClientSelector({ clients, value, onChange, clientsLoading = false }: {
  clients: OrderClient[]; value: string; onChange: (id: string) => void; clientsLoading?: boolean;
}) {
  const { isAdmin, authUser } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const { data: savedIds, isLoading, isError } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('value_json').eq('key', SETTINGS_KEY).maybeSingle();
      if (error) throw error;
      const json = data?.value_json;
      if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
      return Array.isArray(json.account_ids) ? json.account_ids.filter((id): id is string => typeof id === 'string') : null;
    },
  });
  const { data: scheduledLocations = [] } = useQuery({
    queryKey: ['order-selector-location-schedules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('account_locations').select('account_id, production_weekdays').eq('is_active', true);
      if (error) throw error;
      return (data ?? []).filter(location => (location.production_weekdays?.length ?? 0) > 0).map(location => location.account_id);
    },
  });
  const commonIds = savedIds ?? defaultCommonClientIds(clients);
  const commonClients = commonIds.flatMap(id => { const client = clients.find(c => c.id === id); return client ? [client] : []; });
  const groups = groupOrderClients(clients, scheduledLocations);
  const save = useMutation({
    mutationFn: async () => {
      if (!isAdmin || !authUser) throw new Error('Only admins can edit client shortcuts');
      const { error } = await supabase.from('app_settings').upsert({
        key: SETTINGS_KEY, value_json: { account_ids: draftIds },
        updated_at: new Date().toISOString(), updated_by: authUser.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setEditing(false);
      toast.success('Client shortcuts saved');
    },
    onError: () => toast.error('Could not save client shortcuts'),
  });
  return <>
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Common Clients</p>
        {isAdmin && <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit common client shortcuts" aria-label="Edit common client shortcuts" disabled={clientsLoading || isLoading || isError} onClick={() => { setDraftIds(commonIds); setSearch(''); setEditing(true); }}><Settings2 className="h-4 w-4" /></Button>}
      </div>
      <div className="flex flex-wrap gap-2">
        {commonClients.map(client => <Button key={client.id} variant={value === client.id ? 'default' : 'outline'} size="sm" onClick={() => onChange(client.id)}>{client.account_name}</Button>)}
      </div>
      {isError && <p className="text-sm text-destructive">Could not load saved shortcuts.</p>}
    </div>
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">All Clients</p>
      <Select value={value} onValueChange={onChange} disabled={clientsLoading}>
        <SelectTrigger className="w-full max-w-md" aria-label="Choose a client"><SelectValue placeholder="Choose a client..." /></SelectTrigger>
        <SelectContent>
          <SelectGroup><SelectLabel>Scheduled production clients</SelectLabel>
            {groups.scheduled.map(client => <SelectItem key={client.id} value={client.id}>{client.account_name}</SelectItem>)}
          </SelectGroup>
          {groups.other.length > 0 && <><SelectSeparator /><SelectGroup><SelectLabel>Other clients</SelectLabel>{groups.other.map(client => <SelectItem key={client.id} value={client.id}>{client.account_name}</SelectItem>)}</SelectGroup></>}
          {groups.coroastingOnly.length > 0 && <><SelectSeparator /><SelectGroup><SelectLabel>Co-roasting only</SelectLabel>{groups.coroastingOnly.map(client => <SelectItem key={client.id} value={client.id}>{client.account_name}</SelectItem>)}</SelectGroup></>}
        </SelectContent>
      </Select>
    </div>
    <Dialog open={editing} onOpenChange={open => { if (!save.isPending) setEditing(open); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Common client shortcuts</DialogTitle></DialogHeader>
        <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a client…" aria-label="Find a shortcut client" />
        <div className="max-h-80 overflow-y-auto space-y-1">
          {clients.filter(client => client.account_name.toLowerCase().includes(search.toLowerCase())).map(client => <label key={client.id} className="flex items-center gap-3 py-2 text-sm cursor-pointer">
            <Checkbox checked={draftIds.includes(client.id)} disabled={save.isPending} onCheckedChange={checked => setDraftIds(ids => checked === true ? [...ids, client.id] : ids.filter(id => id !== client.id))} />
            {client.account_name}
          </label>)}
        </div>
        <DialogFooter><Button variant="outline" disabled={save.isPending} onClick={() => setEditing(false)}>Cancel</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save shortcuts'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}