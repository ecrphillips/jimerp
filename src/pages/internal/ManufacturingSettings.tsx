import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const DAYS = [
  { value: 1, short: 'Mo' },
  { value: 2, short: 'Tu' },
  { value: 3, short: 'We' },
  { value: 4, short: 'Th' },
  { value: 5, short: 'Fr' },
];

type Loc = { id: string; account_id: string; location_name: string; location_code: string | null; production_weekdays: number[] | null; is_active: boolean };
type Acct = { id: string; account_name: string; production_weekdays: number[] | null };

function toggle(days: number[] | null, v: number): number[] | null {
  const cur = days ?? [];
  const next = cur.includes(v) ? cur.filter(d => d !== v) : [...cur, v].sort((a, b) => a - b);
  return next.length ? next : null;
}

function DayChips({ days, inherited, onToggle, disabled }: { days: number[] | null; inherited?: number[] | null; onToggle: (v: number) => void; disabled?: boolean }) {
  const shown = days ?? inherited ?? [];
  const isInherited = !days && !!inherited;
  return (
    <div className="flex gap-1">
      {DAYS.map(d => {
        const on = shown.includes(d.value);
        return (
          <button
            key={d.value}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(d.value)}
            className={cn(
              'h-7 w-8 rounded text-xs font-medium border transition-colors',
              on && !isInherited && 'bg-primary text-primary-foreground border-primary',
              on && isInherited && 'bg-primary/15 text-primary border-primary/30 border-dashed',
              !on && 'bg-background text-muted-foreground border-border hover:bg-muted',
            )}
          >
            {d.short}
          </button>
        );
      })}
    </div>
  );
}

export default function ManufacturingSettings() {
  const qc = useQueryClient();

  const { data: accounts = [] } = useQuery({
    queryKey: ['mfg-settings-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name, production_weekdays, programs, is_active')
        .contains('programs', ['MANUFACTURING'])
        .order('account_name');
      if (error) throw error;
      return (data ?? []).filter((a: any) => a.is_active !== false) as unknown as Acct[];
    },
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['mfg-settings-locations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('account_locations')
        .select('id, account_id, location_name, location_code, production_weekdays, is_active')
        .eq('is_active', true)
        .order('location_code');
      if (error) throw error;
      return (data ?? []) as unknown as Loc[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['mfg-settings-accounts'] });
    qc.invalidateQueries({ queryKey: ['mfg-settings-locations'] });
    qc.invalidateQueries({ queryKey: ['account-detail'] });
    qc.invalidateQueries({ queryKey: ['account-locations'] });
    qc.invalidateQueries({ queryKey: ['account-default-production-days'] });
  };

  const saveAccount = useMutation({
    mutationFn: async ({ id, days }: { id: string; days: number[] | null }) => {
      const { error } = await supabase.from('accounts').update({ production_weekdays: days } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? 'Failed to save'),
  });

  const saveLocation = useMutation({
    mutationFn: async ({ id, days }: { id: string; days: number[] | null }) => {
      const { error } = await supabase.from('account_locations').update({ production_weekdays: days } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? 'Failed to save'),
  });

  const locsByAccount = useMemo(() => {
    const m = new Map<string, Loc[]>();
    locations.forEach(l => m.set(l.account_id, [...(m.get(l.account_id) ?? []), l]));
    return m;
  }, [locations]);

  const hasAnyDays = (a: Acct) =>
    (a.production_weekdays?.length ?? 0) > 0 || (locsByAccount.get(a.id) ?? []).some(l => (l.production_weekdays?.length ?? 0) > 0);
  const scheduled = accounts.filter(hasAnyDays);
  const unscheduled = accounts.filter(a => !hasAnyDays(a));

  const dayTotals = DAYS.map(d => ({
    ...d,
    count: scheduled.filter(a => {
      const locs = locsByAccount.get(a.id) ?? [];
      if (locs.length) return locs.some(l => (l.production_weekdays ?? a.production_weekdays ?? []).includes(d.value));
      return (a.production_weekdays ?? []).includes(d.value);
    }).length,
  }));

  const busy = saveAccount.isPending || saveLocation.isPending;

  const renderAccount = (a: Acct) => {
    const locs = locsByAccount.get(a.id) ?? [];
    return (
      <div key={a.id} className="border-b border-border last:border-0">
        <div className="flex items-center justify-between gap-4 px-3 py-2">
          <Link to={`/accounts/${a.id}`} className="text-sm font-medium hover:underline truncate">{a.account_name}</Link>
          <DayChips days={a.production_weekdays} disabled={busy} onToggle={v => saveAccount.mutate({ id: a.id, days: toggle(a.production_weekdays, v) })} />
        </div>
        {locs.map(l => (
          <div key={l.id} className="flex items-center justify-between gap-4 pl-8 pr-3 py-1.5 bg-muted/30">
            <div className="text-xs text-muted-foreground truncate">
              {l.location_code ? `${l.location_code} · ` : ''}{l.location_name}
              {!l.production_weekdays && <span className="ml-2 italic">inherits account</span>}
            </div>
            <div className="flex items-center gap-2">
              {l.production_weekdays && (
                <button type="button" className="text-xs text-muted-foreground hover:underline" disabled={busy}
                  onClick={() => saveLocation.mutate({ id: l.id, days: null })}>Reset</button>
              )}
              <DayChips
                days={l.production_weekdays}
                inherited={a.production_weekdays}
                disabled={busy}
                onToggle={v => saveLocation.mutate({ id: l.id, days: toggle(l.production_weekdays ?? a.production_weekdays, v) })}
              />
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Manufacturing Settings</h1>
        <p className="text-sm text-muted-foreground">Settings that drive the Run Sheet and order scheduling.</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Production days</CardTitle>
          <p className="text-xs text-muted-foreground">
            Click a day to turn it on or off — changes save immediately. Accounts set for today appear as priority accounts on the Plan tab.
            Faded dashed days on a location are inherited from the account; clicking one gives that location its own schedule.
          </p>
          <div className="flex gap-3 pt-2 text-xs text-muted-foreground">
            {dayTotals.map(d => <span key={d.value}><span className="font-medium text-foreground">{d.short}</span> {d.count}</span>)}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="border-t border-border">{scheduled.map(renderAccount)}</div>
          {unscheduled.length > 0 && (
            <>
              <div className="px-3 pt-4 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground border-t border-border">
                No production days set ({unscheduled.length})
              </div>
              <div className="opacity-80">{unscheduled.map(renderAccount)}</div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
