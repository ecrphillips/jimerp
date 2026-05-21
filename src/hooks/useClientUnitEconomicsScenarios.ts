import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  DEFAULT_CLIENT_INPUTS,
  type ClientUnitEconomicsInputs,
} from '@/lib/clientUnitEconomics';

export interface ClientScenarioRow {
  id: string;
  account_id: string;
  name: string;
  inputs: ClientUnitEconomicsInputs;
  created_at: string;
  updated_at: string;
}

export function useClientScenarios(accountId: string | null) {
  return useQuery({
    queryKey: ['client-ue-scenarios', accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<ClientScenarioRow[]> => {
      if (!accountId) return [];
      const { data, error } = await supabase
        .from('client_unit_economics_scenarios')
        .select('id, account_id, name, inputs, created_at, updated_at')
        .eq('account_id', accountId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(r => ({
        ...r,
        inputs: { ...DEFAULT_CLIENT_INPUTS, ...((r.inputs as Record<string, unknown>) || {}) } as ClientUnitEconomicsInputs,
      })) as ClientScenarioRow[];
    },
  });
}

export function useClientScenarioAutoSave(
  scenarioId: string | null,
  inputs: ClientUnitEconomicsInputs,
  enabled: boolean,
) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastSerialised = useRef<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled || !scenarioId) return;
    const serialised = JSON.stringify(inputs);
    if (lastSerialised.current === '') {
      lastSerialised.current = serialised;
      return;
    }
    if (lastSerialised.current === serialised) return;

    if (timer.current) clearTimeout(timer.current);
    setStatus('saving');
    timer.current = setTimeout(async () => {
      const { error } = await supabase
        .from('client_unit_economics_scenarios')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ inputs: inputs as any })
        .eq('id', scenarioId);
      if (error) {
        setStatus('error');
        console.error('[client-ue-autosave] failed', error);
      } else {
        lastSerialised.current = serialised;
        setStatus('saved');
        qc.invalidateQueries({ queryKey: ['client-ue-scenarios'] });
        setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 1800);
      }
    }, 1500);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [scenarioId, inputs, enabled, qc]);

  useEffect(() => {
    lastSerialised.current = '';
    setStatus('idle');
  }, [scenarioId]);

  return status;
}
