import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type SampleStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface UpdateSampleStatusVars {
  sampleId: string;
  status: SampleStatus;
  /** Optional reason; only persisted when status === 'REJECTED'. Cleared otherwise. */
  rejected_reason?: string;
  /** Optional label used in the confirmation toast (e.g. the sample name). */
  toastLabel?: string;
}

/**
 * Shared mutation for updating a green sample's status.
 *
 * Behavior matches the existing detail-view logic:
 * - Persists `status`.
 * - When status === 'REJECTED', writes `rejected_reason` (or null if blank).
 * - Otherwise clears `rejected_reason` to null.
 *
 * Invalidates the relevant queries so list and detail views refresh in place.
 * Toast messages are surfaced here; callers don't need to handle success/error toasts.
 */
export function useUpdateSampleStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sampleId, status, rejected_reason }: UpdateSampleStatusVars) => {
      const update: { status: SampleStatus; rejected_reason: string | null } = {
        status,
        rejected_reason: status === 'REJECTED' ? (rejected_reason || null) : null,
      };
      const { error } = await supabase.from('green_samples').update(update).eq('id', sampleId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      const label = vars.toastLabel ? ` ${vars.toastLabel}` : '';
      if (vars.status === 'APPROVED') {
        toast.success(`Approved${label}`);
      } else if (vars.status === 'REJECTED') {
        toast.success(`Rejected${label}`);
      } else {
        toast.success('Status updated');
      }
      queryClient.invalidateQueries({ queryKey: ['green-sample', vars.sampleId] });
      queryClient.invalidateQueries({ queryKey: ['green-samples'] });
    },
    onError: () => toast.error('Failed to update status'),
  });
}
