import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format as formatDate } from 'date-fns';
import { PACKAGING_OPTIONS, type PackagingVariant } from '@/components/PackagingBadge';
import type { ProductFormat } from '@/types/database';
import type { ColumnDef, SaveResult } from '../types';

interface ProductRow {
  id: string;
  product_name: string;
  sku: string | null;
  format: ProductFormat;
  bag_size_g: number;
  is_active: boolean;
  account_id: string | null;
  client_id: string | null;
  packaging_variant: PackagingVariant | null;
  roast_group: string | null;
  internal_packaging_notes: string | null;
  created_at: string;
  account: { account_name: string } | null;
  client: { name: string } | null;
}

const FORMAT_OPTIONS = [
  { value: 'WHOLE_BEAN', label: 'WHOLE_BEAN' },
  { value: 'ESPRESSO', label: 'ESPRESSO' },
  { value: 'FILTER', label: 'FILTER' },
  { value: 'OTHER', label: 'OTHER' },
];

const STATUS_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

const PACKAGING_SELECT_OPTIONS = PACKAGING_OPTIONS.map((p) => ({ value: p.value, label: p.label }));

function getTodayVancouver(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return formatter.format(now);
}

export function useProductsBulkEdit(enabled = true) {
  const queryClient = useQueryClient();

  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ['bulk-edit-products'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, format, bag_size_g, is_active, account_id, client_id, packaging_variant, roast_group, internal_packaging_notes, created_at, account:accounts(account_name), client:clients(name)')
        .order('product_name');
      if (error) throw error;
      return (data ?? []) as unknown as ProductRow[];
    },
  });

  const { data: roastGroups } = useQuery({
    queryKey: ['bulk-edit-roast-groups-active'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group')
        .eq('is_active', true)
        .order('roast_group');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: prices } = useQuery({
    queryKey: ['bulk-edit-prices'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_list')
        .select('product_id, unit_price, effective_date')
        .order('effective_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const currentPrices = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of prices ?? []) {
      if (!(p.product_id in map)) map[p.product_id] = p.unit_price;
    }
    return map;
  }, [prices]);

  const roastGroupOptions = useMemo(
    () => (roastGroups ?? []).map((r) => ({ value: r.roast_group, label: r.roast_group })),
    [roastGroups],
  );

  const columns = useMemo<ColumnDef<ProductRow>[]>(() => [
    {
      key: 'id', header: 'Product ID', type: 'text', readOnly: true, width: '80px',
      getValue: (r) => r.id, format: (v) => String(v ?? '').slice(0, 8),
    },
    {
      key: 'account_name', header: 'Account', type: 'text', readOnly: true, width: '160px',
      getValue: (r) => r.account?.account_name ?? r.client?.name ?? '—',
    },
    {
      key: 'product_name', header: 'Product Name', type: 'text', width: '220px',
      getValue: (r) => r.product_name,
    },
    {
      key: 'sku', header: 'SKU', type: 'text', width: '140px', allowEmpty: true,
      getValue: (r) => r.sku ?? '',
    },
    {
      key: 'packaging_variant', header: 'Packaging', type: 'select', width: '160px',
      options: PACKAGING_SELECT_OPTIONS, allowEmpty: true,
      getValue: (r) => r.packaging_variant,
    },
    {
      key: 'bag_size_g', header: 'Bag (g)', type: 'number', width: '90px',
      getValue: (r) => r.bag_size_g,
    },
    {
      key: 'format', header: 'Format', type: 'select', width: '130px',
      options: FORMAT_OPTIONS, getValue: (r) => r.format,
    },
    {
      key: 'roast_group', header: 'Roast Group', type: 'select', width: '160px',
      options: roastGroupOptions, allowEmpty: true,
      getValue: (r) => r.roast_group,
    },
    {
      key: 'price', header: 'Price (CAD)', type: 'number', width: '110px', allowEmpty: true,
      getValue: (r) => currentPrices[r.id] ?? null,
      format: (v) => (v === null || v === undefined ? '—' : `$${Number(v).toFixed(2)}`),
    },
    {
      key: 'is_active', header: 'Status', type: 'select', width: '110px',
      options: STATUS_OPTIONS,
      getValue: (r) => String(r.is_active),
    },
    {
      key: 'internal_packaging_notes', header: 'Notes', type: 'text', width: '220px', allowEmpty: true,
      getValue: (r) => r.internal_packaging_notes ?? '',
    },
    {
      key: 'created_at', header: 'Created', type: 'text', readOnly: true, width: '110px',
      getValue: (r) => r.created_at,
      format: (v) => (v ? formatDate(new Date(String(v)), 'yyyy-MM-dd') : ''),
    },
  ], [roastGroupOptions, currentPrices]);

  const onCellSave = async (
    row: ProductRow,
    column: ColumnDef<ProductRow>,
    newValue: unknown,
  ): Promise<SaveResult> => {
    try {
      if (column.key === 'price') {
        const num = newValue === null || newValue === '' ? null : Number(newValue);
        if (num === null || Number.isNaN(num) || num < 0) {
          return { success: false, errorMessage: 'Invalid price' };
        }
        const { error } = await supabase.from('price_list').insert({
          product_id: row.id,
          unit_price: num,
          currency: 'CAD',
          effective_date: getTodayVancouver(),
        });
        if (error) return { success: false, errorMessage: error.message };
        await queryClient.invalidateQueries({ queryKey: ['bulk-edit-prices'] });
        await queryClient.invalidateQueries({ queryKey: ['all-prices'] });
        return { success: true, newDisplayValue: num };
      }

      const updatePayload: Record<string, unknown> = {};
      if (column.key === 'is_active') {
        updatePayload.is_active = newValue === 'true' || newValue === true;
      } else {
        const v = newValue === '' ? null : newValue;
        updatePayload[column.key] = v;
      }

      const { error } = await supabase
        .from('products')
        .update(updatePayload as never)
        .eq('id', row.id);
      if (error) return { success: false, errorMessage: error.message };
      await queryClient.invalidateQueries({ queryKey: ['bulk-edit-products'] });
      await queryClient.invalidateQueries({ queryKey: ['all-products'] });
      return { success: true };
    } catch (e) {
      return { success: false, errorMessage: e instanceof Error ? e.message : 'Save failed' };
    }
  };

  return {
    rows: products ?? [],
    isLoading: productsLoading,
    columns,
    getRowId: (r: ProductRow) => r.id,
    onCellSave,
    group: {
      getGroupKey: (r: ProductRow) => r.account?.account_name ?? r.client?.name ?? '—',
      getGroupLabel: (key: string) => key,
    },
  };
}
