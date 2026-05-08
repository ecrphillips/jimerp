import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format as formatDate } from 'date-fns';
import type { ColumnDef, SaveResult } from '../types';

interface RoastGroupRow {
  roast_group: string;
  roast_group_code: string;
  display_name: string;
  default_roaster: 'SAMIAC' | 'LORING' | 'EITHER';
  is_active: boolean;
  is_blend: boolean;
  blend_type: string | null;
  notes: string | null;
  created_at: string;
}

const ROASTER_OPTIONS = [
  { value: 'SAMIAC', label: 'Samiac' },
  { value: 'LORING', label: 'Loring' },
  { value: 'EITHER', label: 'Either' },
];

const STATUS_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

export function useRoastGroupsBulkEdit(enabled = true) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['bulk-edit-roast-groups'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group, roast_group_code, display_name, default_roaster, is_active, is_blend, blend_type, notes, created_at')
        .order('display_name');
      if (error) throw error;
      return (data ?? []) as unknown as RoastGroupRow[];
    },
  });

  const columns = useMemo<ColumnDef<RoastGroupRow>[]>(() => [
    {
      key: 'roast_group_code', header: 'Roast Group ID', type: 'text', readOnly: true, width: '140px',
      getValue: (r) => r.roast_group_code,
    },
    {
      key: 'display_name', header: 'Name', type: 'text', width: '220px',
      getValue: (r) => r.display_name,
    },
    {
      key: 'default_roaster', header: 'Default Roaster', type: 'select', width: '140px',
      options: ROASTER_OPTIONS, getValue: (r) => r.default_roaster,
    },
    {
      key: 'is_active', header: 'Status', type: 'select', width: '110px',
      options: STATUS_OPTIONS, getValue: (r) => String(r.is_active),
    },
    {
      key: 'notes', header: 'Notes', type: 'text', width: '260px', allowEmpty: true,
      getValue: (r) => r.notes ?? '',
    },
    {
      key: 'is_blend', header: 'Is Blend', type: 'text', readOnly: true, width: '90px',
      getValue: (r) => (r.is_blend ? 'Yes' : 'No'),
    },
    {
      key: 'blend_type', header: 'Blend Type', type: 'text', readOnly: true, width: '130px',
      getValue: (r) => r.blend_type ?? '—',
    },
    {
      key: 'created_at', header: 'Created', type: 'text', readOnly: true, width: '110px',
      getValue: (r) => r.created_at,
      format: (v) => (v ? formatDate(new Date(String(v)), 'yyyy-MM-dd') : ''),
    },
  ], []);

  const onCellSave = async (
    row: RoastGroupRow,
    column: ColumnDef<RoastGroupRow>,
    newValue: unknown,
  ): Promise<SaveResult> => {
    try {
      const updatePayload: Record<string, unknown> = {};
      if (column.key === 'is_active') {
        updatePayload.is_active = newValue === 'true' || newValue === true;
      } else {
        const v = newValue === '' ? null : newValue;
        updatePayload[column.key] = v;
      }

      const { error } = await supabase
        .from('roast_groups')
        .update(updatePayload as never)
        .eq('roast_group', row.roast_group);
      if (error) return { success: false, errorMessage: error.message };
      await queryClient.invalidateQueries({ queryKey: ['bulk-edit-roast-groups'] });
      await queryClient.invalidateQueries({ queryKey: ['roast-groups'] });
      await queryClient.invalidateQueries({ queryKey: ['active-roast-groups'] });
      return { success: true };
    } catch (e) {
      return { success: false, errorMessage: e instanceof Error ? e.message : 'Save failed' };
    }
  };

  return {
    rows: data ?? [],
    isLoading,
    columns,
    getRowId: (r: RoastGroupRow) => r.roast_group,
    onCellSave,
  };
}
