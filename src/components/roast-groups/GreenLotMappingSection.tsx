import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Plus, Unlink, AlertTriangle, GitCompare, ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GreenLotPickerModal } from './GreenLotPickerModal';
import { getDisplayName } from '@/lib/roastGroupUtils';
import { executeDepletionSwaps } from '@/components/production/DepletionWarningModal';

interface Props {
  roastGroupKey: string;
  roastGroupDisplayName?: string | null;
}

interface SuccessorTarget {
  linkId: string;
  currentLotId: string;
  currentLotNumber: string;
  currentContractId: string | null;
  currentOriginCountry: string | null;
  currentOriginText: string | null;
  currentSuccessorLotId: string | null;
}

export function GreenLotMappingSection({ roastGroupKey, roastGroupDisplayName }: Props) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [successorTarget, setSuccessorTarget] = useState<SuccessorTarget | null>(null);
  const [swapTarget, setSwapTarget] = useState<{ linkId: string; lotId: string; lotNumber: string; successorLotId: string; successorLotNumber: string; pctOfLot: number | null } | null>(null);
  const [swapping, setSwapping] = useState(false);

  const { data: links = [], isLoading } = useQuery({
    queryKey: ['roast-group-lot-links', roastGroupKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lot_roast_group_links')
        .select(`
          id,
          lot_id,
          pct_of_lot,
          successor_lot_id,
          successor_nominated_at,
          green_lots!green_lot_roast_group_links_lot_id_fkey (
            id, lot_number, status, kg_on_hand, received_date, expected_delivery_date, estimated_days_to_consume,
            contract_id,
            green_contracts ( origin, origin_country )
          ),
          successor:green_lots!green_lot_roast_group_links_successor_lot_id_fkey (
            id, lot_number, status
          )
        `)
        .eq('roast_group', roastGroupKey);
      if (error) throw error;
      return data ?? [];
    },
  });

  const linkedLotIds = new Set(links.map((l: any) => l.lot_id));

  const unlinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase
        .from('green_lot_roast_group_links')
        .delete()
        .eq('id', linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Lot unlinked');
      queryClient.invalidateQueries({ queryKey: ['roast-group-lot-links', roastGroupKey] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to unlink'),
  });

  const updatePctMutation = useMutation({
    mutationFn: async ({ linkId, pct }: { linkId: string; pct: number | null }) => {
      const { error } = await supabase
        .from('green_lot_roast_group_links')
        .update({ pct_of_lot: pct })
        .eq('id', linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roast-group-lot-links', roastGroupKey] });
    },
  });

  const statusColor = (status: string) => {
    if (status === 'EN_ROUTE') return 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300';
    if (status === 'RECEIVED') return 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-300';
    return 'border-border text-muted-foreground';
  };

  const displayName = getDisplayName(roastGroupDisplayName, roastGroupKey);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Green Lot Mapping</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : links.length === 0 ? (
          <p className="text-sm text-muted-foreground">No green lots linked.</p>
        ) : (
          <TooltipProvider>
            <div className="space-y-2">
              {links.map((link: any) => {
                const lot = link.green_lots;
                if (!lot) return null;
                const origin = lot.green_contracts?.origin;
                const successor = link.successor;
                const successorNotReceived = successor && successor.status !== 'RECEIVED';
                return (
                  <div key={link.id} className="flex items-center gap-3 rounded-md border p-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{lot.lot_number}</span>
                        {origin && <span className="text-xs text-muted-foreground">{origin}</span>}
                        <Badge variant="outline" className={cn('text-[10px]', statusColor(lot.status))}>
                          {lot.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{Number(lot.kg_on_hand).toFixed(1)} kg on hand</p>
                      {successor && (
                        <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                          <span>→ Successor: {successor.lot_number} ({successor.status})</span>
                          {successorNotReceived && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent>
                                Successor not yet received — won't auto-swap until it arrives.
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      )}
                      {Number(lot.kg_on_hand) === 0 && successor && successor.status === 'RECEIVED' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-1.5 h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setSwapTarget({
                            linkId: link.id,
                            lotId: lot.id,
                            lotNumber: lot.lot_number,
                            successorLotId: successor.id,
                            successorLotNumber: successor.lot_number,
                            pctOfLot: link.pct_of_lot ?? null,
                          })}
                        >
                          <ArrowRightLeft className="h-3 w-3 mr-1" />
                          Swap to successor now
                        </Button>
                      )}
                      {(() => {
                        if (!lot.estimated_days_to_consume) {
                          return <p className="text-xs text-muted-foreground/60 mt-0.5">No estimate set</p>;
                        }
                        const startDate = lot.status === 'RECEIVED' ? lot.received_date : lot.expected_delivery_date;
                        if (!startDate) return null;
                        const endDate = new Date(startDate + 'T00:00:00');
                        endDate.setDate(endDate.getDate() + lot.estimated_days_to_consume);
                        const daysLeft = Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                        if (daysLeft < 5) {
                          return (
                            <div className="flex items-center gap-1 mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        className="w-20 h-8 text-xs"
                        placeholder="% lot"
                        defaultValue={link.pct_of_lot ?? ''}
                        onBlur={e => {
                          const val = e.target.value ? Number(e.target.value) : null;
                          if (val !== link.pct_of_lot) {
                            updatePctMutation.mutate({ linkId: link.id, pct: val });
                          }
                        }}
                        min={0}
                        max={100}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setSuccessorTarget({
                            linkId: link.id,
                            currentLotId: lot.id,
                            currentLotNumber: lot.lot_number,
                            currentContractId: lot.contract_id ?? null,
                            currentOriginCountry: lot.green_contracts?.origin_country ?? null,
                            currentOriginText: lot.green_contracts?.origin ?? null,
                            currentSuccessorLotId: link.successor_lot_id ?? null,
                          })}
                        >
                          <GitCompare className={cn('h-4 w-4', successor ? 'text-primary' : 'text-muted-foreground')} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {successor ? `Successor: ${successor.lot_number}` : 'Nominate Successor'}
                      </TooltipContent>
                    </Tooltip>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => unlinkMutation.mutate(link.id)}>
                      <Unlink className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </TooltipProvider>
        )}

        <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Link Lot
        </Button>

        <GreenLotPickerModal
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          roastGroupDisplayName={displayName}
          mode={{ kind: 'LINK', roastGroupKey, alreadyLinkedLotIds: linkedLotIds }}
        />

        {successorTarget && (
          <GreenLotPickerModal
            open={!!successorTarget}
            onOpenChange={(o) => { if (!o) setSuccessorTarget(null); }}
            roastGroupDisplayName={displayName}
            mode={{
              kind: 'SUCCESSOR',
              linkId: successorTarget.linkId,
              currentLotId: successorTarget.currentLotId,
              currentLotNumber: successorTarget.currentLotNumber,
              currentContractId: successorTarget.currentContractId,
              currentOriginCountry: successorTarget.currentOriginCountry,
              currentOriginText: successorTarget.currentOriginText,
              currentSuccessorLotId: successorTarget.currentSuccessorLotId,
              excludeLotIds: linkedLotIds,
              roastGroupKey,
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
