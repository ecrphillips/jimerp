import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format as formatDate } from 'date-fns';
import type { ColumnDef, SaveResult } from '../types';

interface LotRow {
  id: string;
  lot_number: string;
  lot_identifier: string | null;
  contract_id: string | null;
  kg_on_hand: number;
  status: string;
  received_date: string | null;
  exceptions_notes: string | null;
  created_at: string;
}

const STATUS_OPTIONS = [
  { value: 'EN_ROUTE', label: 'En Route' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'EXHAUSTED', label: 'Exhausted' },
];

export function useLotsBulkEdit(enabled = true) {
  const queryClient = useQueryClient();

  const { data: lots, isLoading } = useQuery({
    queryKey: ['bulk-edit-lots'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lots')
        .select('id, lot_number, lot_identifier, contract_id, kg_on_hand, status, received_date, exceptions_notes, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as LotRow[];
    },
  });

  const { data: contracts } = useQuery({
    queryKey: ['bulk-edit-lots-contracts'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_contracts')
        .select('id, name, lot_identifier')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const contractOptions = useMemo(
    () => (contracts ?? []).map((c) => ({
      value: c.id,
      label: c.lot_identifier ? `${c.name} (${c.lot_identifier})` : c.name,
    })),
    [contracts],
  );

  const columns = useMemo<ColumnDef<LotRow>[]>(() => [
    {
      key: 'id', header: 'Lot ID', type: 'text', readOnly: true, width: '90px',
      getValue: (r) => r.id, format: (v) => String(v ?? '').slice(0, 8),
    },
    {
      key: 'lot_number', header: 'Lot #', type: 'text', readOnly: true, width: '120px',
      getValue: (r) => r.lot_number,
    },
    {
      key: 'lot_identifier', header: 'Lot Identifier', type: 'text', width: '160px', allowEmpty: true,
      getValue: (r) => r.lot_identifier ?? '',
    },
    {
      key: 'contract_id', header: 'Linked Contract', type: 'select', width: '240px',
      options: contractOptions, allowEmpty: true,
      getValue: (r) => r.contract_id,
    },
    {
      key: 'kg_on_hand', header: 'kg on hand', type: 'number', width: '110px',
      getValue: (r) => r.kg_on_hand,
    },
    {
      key: 'status', header: 'Status', type: 'select', width: '130px',
      options: STATUS_OPTIONS, getValue: (r) => r.status,
    },
    {
      key: 'received_date', header: 'Received', type: 'date', width: '140px', allowEmpty: true,
      getValue: (r) => r.received_date,
    },
    {
      key: 'exceptions_notes', header: 'Notes / Exceptions', type: 'text', width: '260px', allowEmpty: true,
      getValue: (r) => r.exceptions_notes ?? '',
    },
    {
      key: 'created_at', header: 'Created', type: 'text', readOnly: true, width: '110px',
      getValue: (r) => r.created_at,
      format: (v) => (v ? formatDate(new Date(String(v)), 'yyyy-MM-dd') : ''),
    },
  ], [contractOptions]);

  const onCellSave = async (
    row: LotRow,
    column: ColumnDef<LotRow>,
    newValue: unknown,
  ): Promise<SaveResult> => {
    try {
      const updatePayload: Record<string, unknown> = {};
      const v = newValue === '' ? null : newValue;
      updatePayload[column.key] = v;

      const { error } = await supabase
        .from('green_lots')
        .update(updatePayload as never)
        .eq('id', row.id);
      if (error) return { success: false, errorMessage: error.message };
      await queryClient.invalidateQueries({ queryKey: ['bulk-edit-lots'] });
      await queryClient.invalidateQueries({ queryKey: ['green-lots'] });
      return { success: true };
    } catch (e) {
      return { success: false, errorMessage: e instanceof Error ? e.message : 'Save failed' };
    }
  };

  return {
    rows: lots ?? [],
    isLoading,
    columns,
    getRowId: (r: LotRow) => r.id,
    onCellSave,
  };
}
