import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DEFAULT_INPUTS, type UnitEconomicsInputs } from '@/lib/unitEconomics';

export interface ScenarioRow {
  id: string;
  account_id: string | null;
  prospect_id: string | null;
  name: string;
  is_default: boolean;
  inputs: UnitEconomicsInputs;
  created_at: string;
  updated_at: string;
}

export function useScenarios(accountId: string | null) {
  return useQuery({
    queryKey: ['ue-scenarios', accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<ScenarioRow[]> => {
      if (!accountId) return [];
      const { data, error } = await supabase
        .from('coroast_unit_economics_scenarios')
        .select('*')
        .eq('account_id', accountId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(r => ({
        ...r,
        inputs: { ...DEFAULT_INPUTS, ...((r.inputs as Record<string, unknown>) || {}) } as UnitEconomicsInputs,
      })) as ScenarioRow[];
    },
  });
}

/** Debounced auto-save of inputs to a scenario row. Returns a "saving" / "saved" indicator state. */
export function useScenarioAutoSave(
  scenarioId: string | null,
  inputs: UnitEconomicsInputs,
  enabled: boolean,
) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastSerialised = useRef<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled || !scenarioId) return;
    const serialised = JSON.stringify(inputs);
    // Skip the very first run (matches what was just loaded)
    if (lastSerialised.current === '') {
      lastSerialised.current = serialised;
      return;
    }
    if (lastSerialised.current === serialised) return;

    if (timer.current) clearTimeout(timer.current);
    setStatus('saving');
    timer.current = setTimeout(async () => {
      const { error } = await supabase
        .from('coroast_unit_economics_scenarios')
        .update({ inputs: inputs as unknown as Record<string, unknown> })
        .eq('id', scenarioId);
      if (error) {
        setStatus('error');
        console.error('[ue-autosave] failed', error);
      } else {
        lastSerialised.current = serialised;
        setStatus('saved');
        qc.invalidateQueries({ queryKey: ['ue-scenarios'] });
        setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 1800);
      }
    }, 1500);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [scenarioId, inputs, enabled, qc]);

  // Reset baseline when scenario changes
  useEffect(() => {
    lastSerialised.current = '';
    setStatus('idle');
  }, [scenarioId]);

  return status;
}

/** Get this account's tier and most-recent green lot price for sensible pre-fills. */
export function useAccountPrefills(accountId: string | null) {
  const { authUser } = useAuth();

  return useQuery({
    queryKey: ['ue-prefills', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      if (!accountId) return { tier: null as null | 'MEMBER' | 'GROWTH' | 'PRODUCTION', greenPricePerKg: null as number | null };

      // Tier: read from coroast_members linked to this account's client
      // Account has no client_id directly; coroast_members.client_id ↔ clients.id and accounts can share via account_users.
      // Simpler: look for a coroast_members row whose business_name matches account_name (loose), else any active member tied to a client this account user owns.
      // Pragmatic: read tier from accounts.coroast_tier first, fall back to coroast_members.
      const { data: account } = await supabase
        .from('accounts')
        .select('account_name, coroast_tier')
        .eq('id', accountId)
        .maybeSingle();

      let tier: 'MEMBER' | 'GROWTH' | 'PRODUCTION' | null = null;
      const acctTier = account?.coroast_tier;
      if (acctTier === 'MEMBER' || acctTier === 'GROWTH' || acctTier === 'PRODUCTION') tier = acctTier;

      if (!tier && account?.account_name) {
        const { data: m } = await supabase
          .from('coroast_members')
          .select('tier')
          .eq('business_name', account.account_name)
          .eq('is_active', true)
          .maybeSingle();
        const mTier = m?.tier;
        if (mTier === 'MEMBER' || mTier === 'GROWTH' || mTier === 'PRODUCTION') tier = mTier;
      }

      // Green price: take the most recent lot's book_value_per_kg as a friendly default
      const { data: lot } = await supabase
        .from('green_lots')
        .select('book_value_per_kg, created_at')
        .not('book_value_per_kg', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return {
        tier,
        greenPricePerKg: (lot?.book_value_per_kg as number | null) ?? null,
      };
    },
  });
}
