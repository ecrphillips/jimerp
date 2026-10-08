import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowRight, Leaf } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { parseDateOnly } from '@/lib/dateOnly';

// Shape returned by the get_client_green_detail RPC (client-safe fields only).
interface GreenLot {
  lot_id: string;
  lot_number: string;
  coffee_name: string | null;
  status: string;
  /** Arrived at our warehouse (may still be in costing). */
  received: boolean;
  is_placeholder: boolean;
  origin_country: string | null;
  origin: string | null;
  region: string | null;
  producer: string | null;
  variety: string | null;
  crop_year: string | null;
  notes: string | null;
  received_date: string | null;
  expected_delivery_date: string | null;
  running_low: boolean;
  depleted: boolean;
}

interface GreenComponent {
  roast_group: string;
  display_name: string;
  pct: number;
  lots: { current: GreenLot | null; next: GreenLot | null }[];
}

interface GreenDetail {
  roast_group: string;
  display_name: string;
  is_blend: boolean;
  components: GreenComponent[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  roastGroup: string;
  productName: string;
}

const fmtDate = (d: string | null) => (d ? format(parseDateOnly(d)!, 'MMM d, yyyy') : null);

function LotStatus({ lot, isNext }: { lot: GreenLot; isNext: boolean }) {
  if (lot.received) {
    if (isNext) return <span className="text-xs text-muted-foreground">In our warehouse</span>;
    if (lot.depleted) return <span className="text-xs font-medium text-amber-700">Finishing up</span>;
    if (lot.running_low) return <span className="text-xs font-medium text-amber-700">Running low</span>;
    return <span className="text-xs font-medium text-green-700">In use now</span>;
  }
  const eta = fmtDate(lot.expected_delivery_date);
  return (
    <span className="text-xs text-muted-foreground">
      {eta ? `Arriving ~${eta}` : 'On its way'}
    </span>
  );
}

function LotCard({ lot, isNext }: { lot: GreenLot; isNext: boolean }) {
  const origin = [lot.region, lot.origin ?? lot.origin_country].filter(Boolean).join(', ');
  const facts: [string, string | null][] = [
    ['Origin', origin || null],
    ['Producer', lot.producer],
    ['Variety', lot.variety],
    ['Crop year', lot.crop_year],
  ];
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium">
          {lot.is_placeholder ? 'To be confirmed' : lot.coffee_name || origin || lot.lot_number}
        </div>
        <LotStatus lot={lot} isNext={isNext} />
      </div>
      {!lot.is_placeholder && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </React.Fragment>
            ))}
          <dt className="text-muted-foreground">Lot</dt>
          <dd className="font-mono text-xs leading-5">{lot.lot_number}</dd>
        </dl>
      )}
      {lot.notes && <p className="mt-2 text-sm text-muted-foreground">{lot.notes}</p>}
    </div>
  );
}

export function GreenDetailDialog({ open, onOpenChange, accountId, roastGroup, productName }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['client-green-detail', accountId, roastGroup],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_client_green_detail', {
        p_account_id: accountId,
        p_roast_group: roastGroup,
      });
      if (error) throw error;
      return data as unknown as GreenDetail;
    },
  });

  const hasUpcoming = data?.components.some((c) => c.lots.some((l) => l.next));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Leaf className="h-5 w-5 text-green-700" />
            Green coffee — {productName}
          </DialogTitle>
          <DialogDescription>
            The green coffee we're roasting for this product right now, and what's lined up next.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive">Couldn't load green detail. Please try again.</p>
        ) : !data ? null : (
          <div className="space-y-5">
            {data.components.map((c) => (
              <section key={c.roast_group} className="space-y-2">
                {data.is_blend && (
                  <h3 className="text-sm font-semibold">
                    {c.display_name}
                    <span className="ml-2 font-normal text-muted-foreground">{Math.round(c.pct)}% of blend</span>
                  </h3>
                )}
                {c.lots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Lot details aren't listed yet — ask your Home Island rep.
                  </p>
                ) : (
                  c.lots.map((l, i) => (
                    <div key={l.current?.lot_id ?? i} className="space-y-2">
                      {l.current && <LotCard lot={l.current} isNext={false} />}
                      {l.next && (
                        <div className="space-y-1 pl-4">
                          <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-green-700">
                            <ArrowRight className="h-3 w-3" /> Coming up next
                          </div>
                          <LotCard lot={l.next} isNext />
                        </div>
                      )}
                    </div>
                  ))
                )}
              </section>
            ))}
            {!hasUpcoming && (
              <p className="text-xs text-muted-foreground">
                No lot change is scheduled yet. We'll list the next lot here once it's lined up.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
