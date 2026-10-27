import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useRecentRoastTimes, vancouverDate, vancouverTime } from '@/hooks/useDayClose';

const DAYS = 14;
const ROASTERS = ['SAMIAC', 'LORING'] as const;

function minutesOfDay(iso: string): number {
  const [h, m] = vancouverTime(iso).split(':').map(Number);
  return h * 60 + m;
}
function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Admin-only: last roast time per roaster per day, plus day-close times. */
export function RoasterFinishTimesCard() {
  const { data: rows } = useRecentRoastTimes(DAYS);
  const { data: closes } = useQuery({
    queryKey: ['day-closes-recent', DAYS],
    queryFn: async () => {
      const since = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
      const { data, error } = await supabase.from('production_day_closes')
        .select('work_date, kind, closed_at').gte('work_date', since).is('reopened_at', null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { days, avg } = useMemo(() => {
    const byDay: Record<string, Record<string, string>> = {};
    for (const r of rows ?? []) {
      const d = vancouverDate(r.roasted_at);
      const key = r.assigned_roaster ?? 'UNASSIGNED';
      byDay[d] = byDay[d] ?? {};
      if (!byDay[d][key] || r.roasted_at > byDay[d][key]) byDay[d][key] = r.roasted_at;
    }
    const days = Object.keys(byDay).sort().reverse().slice(0, DAYS);
    const avg: Record<string, string> = {};
    for (const ro of ROASTERS) {
      const mins = days.map((d) => byDay[d][ro]).filter(Boolean).map(minutesOfDay);
      avg[ro] = mins.length ? fmtMinutes(mins.reduce((a, b) => a + b, 0) / mins.length) : '—';
    }
    return { days: days.map((d) => ({ date: d, last: byDay[d] })), avg };
  }, [rows]);

  const closeAt = (date: string, kind: string) => {
    const c = (closes ?? []).find((x) => x.work_date === date && x.kind === kind);
    return c ? vancouverTime(c.closed_at) : '—';
  };

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base">Roaster finish times (last {DAYS} days)</CardTitle></CardHeader>
      <CardContent>
        {days.length === 0 ? <p className="text-sm text-muted-foreground">No roasts recorded yet.</p> : (
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-1">Day</th>
                {ROASTERS.map((r) => <th key={r} className="py-1">{r} last roast</th>)}
                <th className="py-1">Roast closed</th>
                <th className="py-1">Shipping closed</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b font-semibold">
                <td className="py-1">Average</td>
                {ROASTERS.map((r) => <td key={r}>{avg[r]}</td>)}
                <td /><td />
              </tr>
              {days.map((d) => (
                <tr key={d.date} className="border-b last:border-0">
                  <td className="py-1">{d.date}</td>
                  {ROASTERS.map((r) => <td key={r}>{d.last[r] ? vancouverTime(d.last[r]) : '—'}</td>)}
                  <td>{closeAt(d.date, 'ROAST')}</td>
                  <td>{closeAt(d.date, 'SHIP')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
