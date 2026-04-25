import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface EffectivePermissions {
  canBookRoaster: boolean;
  canPlaceOrders: boolean;
  canInviteUsers: boolean;
  canManageLocations: boolean;
  coroastTier: string | null;
  programs: string[];
}

interface PreviewContextValue {
  previewAccountId: string | null;
  previewAccountName: string | null;
  isPreviewMode: boolean;
  effectivePermissions: EffectivePermissions | null;
  enterPreview: (accountId: string, accountName: string) => void;
  exitPreview: () => void;
}

const PreviewContext = createContext<PreviewContextValue>({
  previewAccountId: null,
  previewAccountName: null,
  isPreviewMode: false,
  effectivePermissions: null,
  enterPreview: () => {},
  exitPreview: () => {},
});

export function PreviewProvider({ children }: { children: React.ReactNode }) {
  const [previewAccountId, setPreviewAccountId] = useState<string | null>(
    () => sessionStorage.getItem('previewAccountId'),
  );
  const [previewAccountName, setPreviewAccountName] = useState<string | null>(
    () => sessionStorage.getItem('previewAccountName'),
  );
  const [effectivePermissions, setEffectivePermissions] = useState<EffectivePermissions | null>(null);

  // Whenever previewAccountId changes (including initial hydration from sessionStorage),
  // fetch the previewed account's program/tier and its primary owner's permissions.
  useEffect(() => {
    let cancelled = false;

    if (!previewAccountId) {
      setEffectivePermissions(null);
      return;
    }

    (async () => {
      const [{ data: account }, { data: owner }] = await Promise.all([
        supabase
          .from('accounts')
          .select('programs, coroast_tier')
          .eq('id', previewAccountId)
          .maybeSingle(),
        supabase
          .from('account_users')
          .select('can_book_roaster, can_place_orders, can_invite_users, can_manage_locations, created_at')
          .eq('account_id', previewAccountId)
          .eq('is_owner', true)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      setEffectivePermissions({
        canBookRoaster: owner?.can_book_roaster ?? false,
        canPlaceOrders: owner?.can_place_orders ?? false,
        canInviteUsers: owner?.can_invite_users ?? false,
        canManageLocations: owner?.can_manage_locations ?? false,
        coroastTier: account?.coroast_tier ?? null,
        programs: account?.programs ?? [],
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [previewAccountId]);

  const enterPreview = useCallback((accountId: string, accountName: string) => {
    sessionStorage.setItem('previewAccountId', accountId);
    sessionStorage.setItem('previewAccountName', accountName);
    setPreviewAccountId(accountId);
    setPreviewAccountName(accountName);
  }, []);

  const exitPreview = useCallback(() => {
    sessionStorage.removeItem('previewAccountId');
    sessionStorage.removeItem('previewAccountName');
    setPreviewAccountId(null);
    setPreviewAccountName(null);
    setEffectivePermissions(null);
  }, []);

  return (
    <PreviewContext.Provider
      value={{
        previewAccountId,
        previewAccountName,
        isPreviewMode: !!previewAccountId,
        effectivePermissions,
        enterPreview,
        exitPreview,
      }}
    >
      {children}
    </PreviewContext.Provider>
  );
}

export function usePreview() {
  return useContext(PreviewContext);
}
