import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle } from 'lucide-react';
import { format, addDays, startOfMonth, differenceInCalendarDays, isAfter, isBefore, startOfDay } from 'date-fns';

type Horizon = 7 | 30 | 90;

interface CalLot {
  id: string;
  lot_number: string;
  status: string;
  received_date: string | null;
  expected_delivery_date: string | null;
  estimated_days_to_consume: number | null;
  kg_on_hand: number;
  bag_size_kg: number;
  bags_released: number;
  contract_name: string | null;
  origin: string | null;
  roast_groups: { key: string; display_name: string }[];
}

export function CoverageCalendar() {
  const [horizon, setHorizon] = useState<Horizon>(90);

  const { data: calLots = [], isLoading } = useQuery({
    queryKey: ['coverage-calendar-lots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lot_roast_group_links')
        .select(`
          roast_group,
          roast_groups!green_lot_roast_group_links_roast_group_fkey (display_name),
          lot_id,
          green_lots!green_lot_roast_group_links_lot_id_fkey (
            id, lot_number, status, received_date, expected_delivery_date,
            estimated_days_to_consume, kg_on_hand, bag_size_kg, bags_released,
            contract_id,
            green_contracts (name, origin)
          )
        `);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30000,
  });

  // Transform into grouped structure
  const { grouped, missingEstimates } = useMemo(() => {
    const today = startOfDay(new Date());
    const rgMap = new Map<string, { displayName: string; lots: CalLot[] }>();
    const missingSet = new Map<string, string>(); // lot_id -> lot_number

    for (const row of calLots) {
      const lot = row.green_lots as any;
      if (!lot || lot.status === 'EXHAUSTED') continue;

      const rgKey = row.roast_group;
      const rgName = (row.roast_groups as any)?.display_name || rgKey;

      // Determine start date
      let startDate: string | null = null;
      if (lot.status === 'RECEIVED' && lot.received_date) {
        startDate = lot.received_date;
      } else if (lot.expected_delivery_date) {
        startDate = lot.expected_delivery_date;
      }
      if (!startDate) continue;

      if (!lot.estimated_days_to_consume) {
        missingSet.set(lot.id, lot.lot_number);
      }

      if (!rgMap.has(rgKey)) {
        rgMap.set(rgKey, { displayName: rgName, lots: [] });
      }

      // Avoid duplicates within same roast group
      const group = rgMap.get(rgKey)!;
      if (!group.lots.some(l => l.id === lot.id)) {
        group.lots.push({
          id: lot.id,
          lot_number: lot.lot_number,
          status: lot.status,
          received_date: lot.received_date,
          expected_delivery_date: lot.expected_delivery_date,
          estimated_days_to_consume: lot.estimated_days_to_consume,
          kg_on_hand: lot.kg_on_hand,
          bag_size_kg: lot.bag_size_kg,
          bags_released: lot.bags_released,
          contract_name: lot.green_contracts?.name || null,
          origin: lot.green_contracts?.origin || null,
          roast_groups: [{ key: rgKey, display_name: rgName }],
        });
      }
    }

    // Sort lots within each group
    for (const group of rgMap.values()) {
      group.lots.sort((a, b) => {
        const aStart = a.status === 'RECEIVED' ? a.received_date : a.expected_delivery_date;
        const bStart = b.status === 'RECEIVED' ? b.received_date : b.expected_delivery_date;
        return (aStart || '').localeCompare(bStart || '');
      });
    }

    const sorted = Array.from(rgMap.entries()).sort((a, b) =>
      a[1].displayName.localeCompare(b[1].displayName)
    );

    return {
      grouped: sorted,
      missingEstimates: Array.from(missingSet.entries()).map(([id, num]) => ({ id, lot_number: num })),
    };
  }, [calLots]);

  // Time axis
  const today = startOfDay(new Date());
  const axisStart = today;
  const axisEnd = addDays(today, horizon);
  const totalDays = horizon;

  const toPercent = (date: Date) => {
    const days = differenceInCalendarDays(date, axisStart);
    return Math.max(0, Math.min(100, (days / totalDays) * 100));
  };

  // Axis markers based on horizon
  const axisMarkers = useMemo(() => {
    const markers: { label: string; pct: number }[] = [];
    if (horizon === 7) {
      // One marker per day
      for (let i = 0; i < 7; i++) {
        const d = addDays(axisStart, i);
        markers.push({ label: format(d, 'EEE d'), pct: toPercent(d) });
      }
    } else if (horizon === 30) {
      // One marker per week
      for (let i = 0; i < 30; i += 7) {
        const d = addDays(axisStart, i);
        markers.push({ label: format(d, 'MMM d'), pct: toPercent(d) });
      }
    } else {
      // 90d — monthly markers
      let d = startOfMonth(addDays(axisStart, 32));
      while (isBefore(d, axisEnd)) {
        markers.push({ label: format(d, 'MMM'), pct: toPercent(d) });
        d = startOfMonth(addDays(d, 32));
      }
    }
    return markers;
  }, [horizon]);

  const todayPct = toPercent(today);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (grouped.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No lots are linked to roast groups yet. Link lots from the Roast Groups section.
      </p>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {/* Horizon toggle */}
        <div className="flex items-center gap-2">
          {([7, 30, 90] as Horizon[]).map(h => (
            <Button key={h} variant={horizon === h ? 'default' : 'outline'} size="sm" onClick={() => setHorizon(h)}>
              {h}d
            </Button>
          ))}
        </div>

        {/* Calendar */}
        <div className="border rounded-lg overflow-hidden">
          {/* Time axis header */}
          <div className="flex border-b bg-muted/50">
            <div className="w-[150px] shrink-0 px-3 py-2 text-xs font-medium text-muted-foreground border-r">
              Lot
            </div>
            <div className="flex-1 relative h-8 min-w-[400px]">
              {/* Today label */}
              <div className="absolute top-0 text-[10px] text-destructive font-medium" style={{ left: `${todayPct}%`, transform: 'translateX(-50%)' }}>
                Today
              </div>
              {axisMarkers.map((m, i) => (
                <div key={i} className="absolute bottom-0 text-[10px] text-muted-foreground" style={{ left: `${m.pct}%` }}>
                  {m.label}
                </div>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div className="overflow-x-auto">
            {grouped.map(([rgKey, group]) => (
              <div key={rgKey}>
                {/* Roast group header */}
                <div className="flex bg-muted/30 border-b">
                  <div className="w-[150px] shrink-0 px-3 py-1.5 text-xs font-semibold border-r truncate">
                    {group.displayName}
                  </div>
                  <div className="flex-1 min-w-[400px]" />
                </div>

                {/* Lot rows */}
                {group.lots.map(lot => {
                  const rawStart = lot.status === 'RECEIVED' ? lot.received_date : lot.expected_delivery_date;
                  if (!rawStart) return null;
                  const barStart = new Date(rawStart + 'T00:00:00');
                  const isOpenEnded = !lot.estimated_days_to_consume;
                  const barEnd = isOpenEnded ? axisEnd : addDays(barStart, lot.estimated_days_to_consume!);

                  const leftPct = toPercent(barStart);
                  const rightPct = isOpenEnded ? 100 : toPercent(barEnd);
                  const widthPct = Math.max(0.5, rightPct - leftPct);

                  const isEnRoute = lot.status === 'EN_ROUTE';
                  const endDateLabel = isOpenEnded ? 'Unknown' : format(barEnd, 'MMM d, yyyy');

                  // Low coverage check
                  const isLowCoverage = !isOpenEnded && differenceInCalendarDays(barEnd, today) < 5;

                  return (
                    <div key={lot.id} className="flex border-b last:border-b-0 hover:bg-muted/20">
                      {/* Label column */}
                      <div className="w-[150px] shrink-0 px-3 py-2 border-r flex items-center gap-1.5 sticky left-0 bg-background z-10">
                        <span className="text-xs font-medium truncate">{lot.lot_number}</span>
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1 py-0 border-0 shrink-0 ${
                            isEnRoute
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                              : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          }`}
                        >
                          {isEnRoute ? 'ET' : 'RX'}
                        </Badge>
                      </div>

                      {/* Bar track */}
                      <div className="flex-1 relative h-10 min-w-[400px]">
                        {/* Grid lines */}
                        {axisMarkers.map((m, i) => (
                          <div key={`grid-${i}`} className="absolute top-0 bottom-0 w-px border-l border-border/40" style={{ left: `${m.pct}%` }} />
                        ))}
                        {/* Today line */}
                        <div
                          className="absolute top-0 bottom-0 w-px border-l border-dashed border-destructive z-10"
                          style={{ left: `${todayPct}%` }}
                        />

                        {/* Bar */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className={`absolute top-2 h-6 rounded-sm flex items-center justify-end pr-1 ${
                                isEnRoute
                                  ? 'bg-amber-400 dark:bg-amber-600'
                                  : 'bg-green-500 dark:bg-green-600'
                              } ${isOpenEnded ? 'border-r-2 border-dashed border-muted-foreground' : ''}`}
                              style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                                backgroundImage: isEnRoute
                                  ? 'repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(0,0,0,0.08) 3px, rgba(0,0,0,0.08) 6px)'
                                  : undefined,
                              }}
                            >
                              {isOpenEnded && (
                                <span className="text-[9px] font-medium text-muted-foreground">?</span>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs space-y-1 max-w-[240px]">
                            <p className="font-semibold">{lot.lot_number}</p>
                            {lot.contract_name && (
                              <p>{lot.contract_name}{lot.origin ? ` · ${lot.origin}` : ''}</p>
                            )}
                            <p>Start: {format(barStart, 'MMM d, yyyy')}</p>
                            <p>End: {endDateLabel}</p>
                            <p>On hand: {Number(lot.kg_on_hand).toFixed(1)} kg</p>
                            <p>Est. days: {lot.estimated_days_to_consume ?? 'Not set'}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Missing estimates warning */}
        {missingEstimates.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              These lots are missing coverage estimates — open each lot to set Est. Days to Consume.
            </div>
            <div className="flex flex-wrap gap-2 pl-6">
              {missingEstimates.map(l => (
                <Badge key={l.id} variant="outline" className="text-xs">{l.lot_number}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
