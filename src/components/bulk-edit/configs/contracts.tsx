import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format as formatDate } from 'date-fns';
import type { ColumnDef, SaveResult } from '../types';

type ContractStatus = 'ACTIVE' | 'DEPLETED' | 'CANCELLED';

interface ContractRow {
  id: string;
  name: string;
  origin: string | null;
  lot_identifier: string | null;
  num_bags: number | null;
  bag_size_kg: number | null;
  contracted_price_usd: number | null;
  status: ContractStatus;
  notes: string | null;
  vendor_id: string | null;
  vendor_contract_number: string | null;
  internal_contract_number: string | null;
  created_at: string;
}

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DEPLETED', label: 'Depleted' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function useContractsBulkEdit(enabled = true) {
  const queryClient = useQueryClient();

  const { data: contracts, isLoading } = useQuery({
    queryKey: ['bulk-edit-contracts'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_contracts')
        .select('id, name, origin, lot_identifier, num_bags, bag_size_kg, contracted_price_usd, status, notes, vendor_id, vendor_contract_number, internal_contract_number, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ContractRow[];
    },
  });

  const { data: vendors } = useQuery({
    queryKey: ['bulk-edit-vendors-active'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_vendors')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const vendorOptions = useMemo(
    () => (vendors ?? []).map((v) => ({ value: v.id, label: v.name })),
    [vendors],
  );

  const columns = useMemo<ColumnDef<ContractRow>[]>(() => [
    {
      key: 'id', header: 'Contract ID', type: 'text', readOnly: true, width: '90px',
      getValue: (r) => r.id, format: (v) => String(v ?? '').slice(0, 8),
    },
    {
      key: 'vendor_contract_number', header: 'PO #', type: 'text', readOnly: true, width: '120px',
      getValue: (r) => r.vendor_contract_number ?? r.internal_contract_number ?? '—',
    },
    {
      key: 'vendor_id', header: 'Vendor', type: 'select', width: '180px',
      options: vendorOptions, allowEmpty: true,
      getValue: (r) => r.vendor_id,
    },
    {
      key: 'origin', header: 'Origin', type: 'text', width: '160px', allowEmpty: true,
      getValue: (r) => r.origin ?? '',
    },
    {
      key: 'lot_identifier', header: 'Lot Identifier', type: 'text', width: '160px', allowEmpty: true,
      getValue: (r) => r.lot_identifier ?? '',
    },
    {
      key: 'name', header: 'Coffee / Description', type: 'text', width: '240px',
      getValue: (r) => r.name,
    },
    {
      key: 'num_bags', header: 'Bags', type: 'number', width: '90px', allowEmpty: true,
      getValue: (r) => r.num_bags,
    },
    {
      key: 'bag_size_kg', header: 'Bag (kg)', type: 'number', width: '90px', allowEmpty: true,
      getValue: (r) => r.bag_size_kg,
    },
    {
      key: 'contracted_price_usd', header: 'Price USD/lb', type: 'number', width: '110px', allowEmpty: true,
      getValue: (r) => r.contracted_price_usd,
      format: (v) => (v === null || v === undefined ? '—' : `$${Number(v).toFixed(3)}`),
    },
    {
      key: 'status', header: 'Status', type: 'select', width: '120px',
      options: STATUS_OPTIONS, getValue: (r) => r.status,
    },
    {
      key: 'notes', header: 'Notes', type: 'text', width: '240px', allowEmpty: true,
      getValue: (r) => r.notes ?? '',
    },
    {
      key: 'created_at', header: 'Created', type: 'text', readOnly: true, width: '110px',
      getValue: (r) => r.created_at,
      format: (v) => (v ? formatDate(new Date(String(v)), 'yyyy-MM-dd') : ''),
    },
  ], [vendorOptions]);

  const onCellSave = async (
    row: ContractRow,
    column: ColumnDef<ContractRow>,
    newValue: unknown,
  ): Promise<SaveResult> => {
    try {
      const updatePayload: Record<string, unknown> = {};
      const v = newValue === '' ? null : newValue;
      updatePayload[column.key] = v;

      const { error } = await supabase
        .from('green_contracts')
        .update(updatePayload as never)
        .eq('id', row.id);
      if (error) return { success: false, errorMessage: error.message };
      await queryClient.invalidateQueries({ queryKey: ['bulk-edit-contracts'] });
      await queryClient.invalidateQueries({ queryKey: ['green-contracts'] });
      return { success: true };
    } catch (e) {
      return { success: false, errorMessage: e instanceof Error ? e.message : 'Save failed' };
    }
  };

  return {
    rows: contracts ?? [],
    isLoading,
    columns,
    getRowId: (r: ContractRow) => r.id,
    onCellSave,
  };
}
