import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Trash2, Save, ClipboardPaste } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type PackagingVariant = Database['public']['Enums']['packaging_variant'];
type BoardSource = Database['public']['Enums']['board_source'];

const PACKAGING_OPTIONS: { value: PackagingVariant; label: string }[] = [
  { value: 'RETAIL_250G', label: 'Retail bag – 250g' },
  { value: 'RETAIL_300G', label: 'Retail bag – 300g' },
  { value: 'RETAIL_340G', label: 'Retail bag – 340g' },
  { value: 'RETAIL_454G', label: 'Retail bag – 454g' },
  { value: 'CROWLER_200G', label: 'Crowler can – 200g' },
  { value: 'CROWLER_250G', label: 'Crowler can – 250g' },
  { value: 'CAN_125G', label: 'Can – 125g' },
  { value: 'BULK_2LB', label: 'Bulk – 2lb' },
  { value: 'BULK_1KG', label: 'Bulk – 1kg' },
  { value: 'BULK_5LB', label: 'Bulk – 5lb' },
  { value: 'BULK_2KG', label: 'Bulk – 2kg' },
];

const BAG_SIZE_MAP: Record<PackagingVariant, number> = {
  RETAIL_250G: 250,
  RETAIL_300G: 300,
  RETAIL_340G: 340,
  RETAIL_454G: 454,
  CROWLER_200G: 200,
  CROWLER_250G: 250,
  CAN_125G: 125,
  BULK_2LB: 907,
  BULK_1KG: 1000,
  BULK_5LB: 2268,
  BULK_2KG: 2000,
};

const BOARD_OPTIONS: { value: string; label: string }[] = [
  { value: 'NONE', label: 'None' },
  { value: 'MATCHSTICK', label: 'Matchstick' },
  { value: 'FUNK', label: 'Funk' },
];

interface BulkRow {
  id: string;
  clientId: string;
  productName: string;
  sku: string;
  packagingVariant: PackagingVariant | '';
  isActive: boolean;
  initialPrice: string;
  addToBoard: 'NONE' | BoardSource;
}

const createEmptyRow = (): BulkRow => ({
  id: crypto.randomUUID(),
  clientId: '',
  productName: '',
  sku: '',
  packagingVariant: '',
  isActive: true,
  initialPrice: '0.00',
  addToBoard: 'NONE',
});

export default function BulkProducts() {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<BulkRow[]>(() => 
    Array.from({ length: 10 }, createEmptyRow)
  );

  // Fetch clients
  const { data: clients = [] } = useQuery({
    queryKey: ['clients-for-bulk'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Get today in Vancouver timezone
  const getTodayVancouver = useCallback(() => {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Vancouver',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }, []);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (validRows: BulkRow[]) => {
      const todayVancouver = getTodayVancouver();
      const results: { productId: string; row: BulkRow }[] = [];

      for (const row of validRows) {
        // Create product
        const { data: product, error: productError } = await supabase
          .from('products')
          .insert({
            client_id: row.clientId,
            product_name: row.productName,
            sku: row.sku || null,
            packaging_variant: row.packagingVariant as PackagingVariant,
            bag_size_g: BAG_SIZE_MAP[row.packagingVariant as PackagingVariant],
            format: 'OTHER',
            is_active: row.isActive,
            grind_options: [],
          })
          .select('id')
          .single();

        if (productError) throw productError;
        results.push({ productId: product.id, row });
      }

      // Create price list entries
      const priceInserts = results
        .filter(r => r.row.initialPrice !== '')
        .map(r => ({
          product_id: r.productId,
          unit_price: parseFloat(r.row.initialPrice) || 0,
          currency: 'CAD',
          effective_date: todayVancouver,
        }));

      if (priceInserts.length > 0) {
        const { error: priceError } = await supabase
          .from('price_list')
          .insert(priceInserts);
        if (priceError) throw priceError;
      }

      // Create board product entries
      const boardInserts = results
        .filter(r => r.row.addToBoard !== 'NONE')
        .map((r, idx) => ({
          product_id: r.productId,
          source: r.row.addToBoard as BoardSource,
          display_order: idx,
          is_active: true,
        }));

      if (boardInserts.length > 0) {
        const { error: boardError } = await supabase
          .from('source_board_products')
          .insert(boardInserts);
        if (boardError) throw boardError;
      }

      return results.length;
    },
    onSuccess: (count) => {
      toast.success(`Created ${count} product(s) successfully`);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['all-prices'] });
      queryClient.invalidateQueries({ queryKey: ['board-products'] });
      // Reset rows
      setRows(Array.from({ length: 10 }, createEmptyRow));
    },
    onError: (error) => {
      console.error('Bulk save error:', error);
      toast.error('Failed to save products');
    },
  });

  const updateRow = (id: string, field: keyof BulkRow, value: string | boolean) => {
    setRows(prev => prev.map(row => 
      row.id === id ? { ...row, [field]: value } : row
    ));
  };

  const addRow = () => {
    if (rows.length >= 50) {
      toast.error('Maximum 50 rows allowed');
      return;
    }
    setRows(prev => [...prev, createEmptyRow()]);
  };

  const removeRow = (id: string) => {
    if (rows.length <= 1) {
      toast.error('At least one row required');
      return;
    }
    setRows(prev => prev.filter(row => row.id !== id));
  };

  // Handle paste from clipboard
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;

    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) return;

    e.preventDefault();

    // Parse pasted data - expects: client_name, product_name, sku, packaging_variant, is_active, price, board
    const newRows: BulkRow[] = [];
    
    for (const line of lines) {
      const cols = line.split('\t').map(c => c.trim());
      if (cols.length < 2) continue;

      const clientName = cols[0] || '';
      const client = clients.find(c => 
        c.name.toLowerCase() === clientName.toLowerCase()
      );

      const packagingInput = (cols[3] || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const packagingVariant = PACKAGING_OPTIONS.find(p => 
        p.value === packagingInput || p.value.includes(packagingInput)
      )?.value || '';

      const isActiveInput = (cols[4] || 'true').toLowerCase();
      const isActive = isActiveInput !== 'false' && isActiveInput !== '0' && isActiveInput !== 'no';

      const boardInput = (cols[6] || 'NONE').toUpperCase();
      const addToBoard = BOARD_OPTIONS.find(b => 
        b.value === boardInput
      )?.value as 'NONE' | BoardSource || 'NONE';

      newRows.push({
        id: crypto.randomUUID(),
        clientId: client?.id || '',
        productName: cols[1] || '',
        sku: cols[2] || '',
        packagingVariant: packagingVariant as PackagingVariant | '',
        isActive,
        initialPrice: cols[5] || '0.00',
        addToBoard,
      });
    }

    if (newRows.length > 0) {
      setRows(prev => {
        // Replace empty rows with pasted data
        const emptyCount = prev.filter(r => !r.productName && !r.clientId).length;
        const nonEmpty = prev.filter(r => r.productName || r.clientId);
        const combined = [...nonEmpty, ...newRows];
        // Ensure we don't exceed 50
        return combined.slice(0, 50);
      });
      toast.success(`Pasted ${newRows.length} row(s)`);
    }
  }, [clients]);

  const handleSave = () => {
    // Validate rows
    const validRows = rows.filter(row => 
      row.clientId && row.productName && row.packagingVariant
    );

    if (validRows.length === 0) {
      toast.error('No valid rows to save. Each row needs client, product name, and packaging.');
      return;
    }

    saveMutation.mutate(validRows);
  };

  const filledRows = rows.filter(r => r.productName || r.clientId);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bulk Product Entry</h1>
          <p className="text-muted-foreground">
            Paste from Excel or fill manually. Created products with a price are immediately orderable.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={addRow} disabled={rows.length >= 50}>
            <Plus className="h-4 w-4 mr-2" />
            Add Row
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending || filledRows.length === 0}>
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? 'Saving...' : `Save ${filledRows.length} Products`}
          </Button>
        </div>
      </div>

      {/* Paste hint */}
      <div className="bg-muted/50 border rounded-lg p-4 text-sm">
        <div className="flex items-center gap-2 mb-2">
          <ClipboardPaste className="h-4 w-4" />
          <span className="font-medium">Paste Format (tab-separated):</span>
        </div>
        <code className="text-xs bg-background px-2 py-1 rounded">
          client_name	product_name	sku	packaging_variant	is_active	price	board
        </code>
        <p className="mt-2 text-muted-foreground text-xs">
          Example: <code>Matchstick	Dark Roast	MS-001	RETAIL_340G	true	15.00	MATCHSTICK</code>
        </p>
      </div>

      <div 
        className="border rounded-lg overflow-auto max-h-[600px]"
        onPaste={handlePaste}
      >
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead className="min-w-[180px]">Client *</TableHead>
              <TableHead className="min-w-[200px]">Product Name *</TableHead>
              <TableHead className="min-w-[120px]">SKU</TableHead>
              <TableHead className="min-w-[180px]">Packaging *</TableHead>
              <TableHead className="w-20">Active</TableHead>
              <TableHead className="min-w-[100px]">Price (CAD)</TableHead>
              <TableHead className="min-w-[130px]">Add to Board</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={row.id}>
                <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                <TableCell>
                  <Select
                    value={row.clientId}
                    onValueChange={(v) => updateRow(row.id, 'clientId', v)}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Select client" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    value={row.productName}
                    onChange={(e) => updateRow(row.id, 'productName', e.target.value)}
                    placeholder="Product name"
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={row.sku}
                    onChange={(e) => updateRow(row.id, 'sku', e.target.value)}
                    placeholder="SKU"
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={row.packagingVariant}
                    onValueChange={(v) => updateRow(row.id, 'packagingVariant', v)}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Select packaging" />
                    </SelectTrigger>
                    <SelectContent>
                      {PACKAGING_OPTIONS.map(p => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={row.isActive}
                    onChange={(e) => updateRow(row.id, 'isActive', e.target.checked)}
                    className="h-4 w-4"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.initialPrice}
                    onChange={(e) => updateRow(row.id, 'initialPrice', e.target.value)}
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={row.addToBoard}
                    onValueChange={(v) => updateRow(row.id, 'addToBoard', v as 'NONE' | BoardSource)}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BOARD_OPTIONS.map(b => (
                        <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeRow(row.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-muted-foreground">
        {rows.length} rows • {filledRows.length} with data • Maximum 50 rows
      </p>
    </div>
  );
}
