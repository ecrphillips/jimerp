import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

type InventoryType = 'WIP_ROASTED' | 'FG_PACKED';

interface LedgerEntry {
  id: string;
  timestamp: string;
  inventoryType: InventoryType;
  groupOrProduct: string;
  delta: number;
  unit: 'kg' | 'units';
  reason: string;
  reference: string;
}

export default function InventoryLedger() {
  // Fetch WIP ledger entries
  const { data: wipEntries, isLoading: wipLoading } = useQuery({
    queryKey: ['wip-ledger-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wip_ledger')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  // Fetch FG inventory log entries with product info
  const { data: fgEntries, isLoading: fgLoading } = useQuery({
    queryKey: ['fg-inventory-log-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fg_inventory_log')
        .select(`
          *,
          product:products(product_name, sku)
        `)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  // Transform and combine entries
  const ledgerEntries: LedgerEntry[] = [];

  // Transform WIP entries
  wipEntries?.forEach((entry) => {
    const reasonMap: Record<string, string> = {
      ROAST_OUTPUT: 'Roasted Batch',
      PACK_CONSUME: 'Packed',
      LOSS: 'Loss',
      ADJUSTMENT: 'Adjustment',
      REALLOCATE_IN: 'Reallocate In',
      REALLOCATE_OUT: 'Reallocate Out',
      DECONSTRUCT_IN: 'Deconstruct In',
      DECONSTRUCT_OUT: 'Deconstruct Out',
    };

    ledgerEntries.push({
      id: `wip-${entry.id}`,
      timestamp: entry.created_at,
      inventoryType: 'WIP_ROASTED',
      groupOrProduct: entry.roast_group,
      delta: Number(entry.delta_kg),
      unit: 'kg',
      reason: reasonMap[entry.entry_type] || entry.entry_type,
      reference: entry.related_batch_id 
        ? `Batch: ${entry.related_batch_id.slice(0, 8)}...`
        : entry.notes || '—',
    });
  });

  // Transform FG entries
  fgEntries?.forEach((entry) => {
    const product = entry.product as { product_name: string; sku: string } | null;
    
    ledgerEntries.push({
      id: `fg-${entry.id}`,
      timestamp: entry.created_at,
      inventoryType: 'FG_PACKED',
      groupOrProduct: product?.sku || product?.product_name || 'Unknown',
      delta: entry.units_delta,
      unit: 'units',
      reason: entry.units_delta > 0 ? 'Adjustment (+)' : entry.units_delta < 0 ? 'Adjustment (-)' : 'Set',
      reference: entry.notes || '—',
    });
  });

  // Sort by timestamp descending
  ledgerEntries.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const isLoading = wipLoading || fgLoading;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Inventory Ledger</h1>
        <p className="text-muted-foreground">
          Chronological record of all inventory movements
        </p>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">Timestamp</TableHead>
              <TableHead className="w-[120px]">Type</TableHead>
              <TableHead>Group / Product</TableHead>
              <TableHead className="w-[120px] text-right">Delta</TableHead>
              <TableHead className="w-[140px]">Reason</TableHead>
              <TableHead>Reference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                </TableRow>
              ))
            ) : ledgerEntries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No inventory movements recorded yet
                </TableCell>
              </TableRow>
            ) : (
              ledgerEntries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono text-sm">
                    {format(new Date(entry.timestamp), 'MMM d, yyyy HH:mm')}
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant={entry.inventoryType === 'WIP_ROASTED' ? 'default' : 'secondary'}
                      className="font-mono text-xs"
                    >
                      {entry.inventoryType === 'WIP_ROASTED' ? 'WIP' : 'FG'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    {entry.groupOrProduct}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <span className={entry.delta >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {entry.delta >= 0 ? '+' : ''}{entry.delta.toFixed(entry.unit === 'kg' ? 2 : 0)} {entry.unit}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {entry.reason}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">
                    {entry.reference}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
