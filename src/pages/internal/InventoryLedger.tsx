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
import { useInventoryTransactions, type InventoryTransactionType } from '@/hooks/useInventoryLedger';

// Map transaction types to display labels
const transactionTypeLabels: Record<InventoryTransactionType, string> = {
  ROAST_OUTPUT: 'Roast Output',
  PACK_CONSUME_WIP: 'Pack Consume WIP',
  PACK_PRODUCE_FG: 'Pack Produce FG',
  SHIP_CONSUME_FG: 'Ship Consume FG',
  ADJUSTMENT: 'Adjustment',
  LOSS: 'Loss',
};

// Determine if transaction affects WIP (kg) or FG (units)
function getInventoryType(type: InventoryTransactionType): 'WIP' | 'FG' {
  if (type === 'ROAST_OUTPUT' || type === 'PACK_CONSUME_WIP') {
    return 'WIP';
  }
  return 'FG';
}

interface LedgerEntry {
  id: string;
  timestamp: string;
  inventoryType: 'WIP' | 'FG';
  groupOrProduct: string;
  delta: number;
  unit: 'kg' | 'units';
  reason: string;
  reference: string;
  isSystemGenerated: boolean;
}

export default function InventoryLedger() {
  // Fetch inventory transactions from the new ledger table
  const { data: transactions, isLoading } = useInventoryTransactions(500);

  // Transform transactions to ledger entries
  const ledgerEntries: LedgerEntry[] = (transactions ?? []).map((tx) => {
    const inventoryType = getInventoryType(tx.transaction_type);
    const isWip = inventoryType === 'WIP';
    
    return {
      id: tx.id,
      timestamp: tx.created_at,
      inventoryType,
      groupOrProduct: isWip ? (tx.roast_group ?? 'Unknown') : (tx.product_id ?? 'Unknown'),
      delta: isWip ? Number(tx.quantity_kg ?? 0) : (tx.quantity_units ?? 0),
      unit: isWip ? 'kg' : 'units',
      reason: transactionTypeLabels[tx.transaction_type],
      reference: tx.order_id 
        ? `Order: ${tx.order_id.slice(0, 8)}...`
        : tx.notes || '—',
      isSystemGenerated: tx.is_system_generated,
    };
  });

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
                      variant={entry.inventoryType === 'WIP' ? 'default' : 'secondary'}
                      className="font-mono text-xs"
                    >
                      {entry.inventoryType}
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
