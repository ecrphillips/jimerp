import { Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { usePreview } from '@/contexts/PreviewContext';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import type { AppRole } from '@/types/database';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, authUser, loading, signOut } = useAuth();
  const { isPreviewMode } = usePreview();
  const location = useLocation();

  // For CLIENT users with an accountId, check if the account has COROASTING in programs
  const { data: accountPrograms, isLoading: programsLoading } = useQuery({
    queryKey: ['account-programs', authUser?.accountId],
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('programs')
        .eq('id', authUser!.accountId!)
        .maybeSingle();
      return data?.programs ?? [];
    },
    enabled: !!authUser && authUser.role === 'CLIENT' && !!authUser.accountId,
    staleTime: 5 * 60 * 1000,
  });

  const isCoroastMember = authUser?.canBookRoaster && accountPrograms?.includes('COROASTING');

  if (loading || (authUser?.role === 'CLIENT' && authUser?.accountId && programsLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (!authUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="mx-4 max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
          <h2 className="mb-2 text-lg font-semibold">Account Pending</h2>
          <p className="text-muted-foreground mb-4">
            Your account is awaiting role assignment. Please contact an administrator.
          </p>
          <Button variant="outline" onClick={() => signOut()}>Sign Out</Button>
        </div>
      </div>
    );
  }

  if (!authUser.isActive) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="mx-4 max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
          <h2 className="mb-2 text-lg font-semibold text-destructive">Account Disabled</h2>
          <p className="text-muted-foreground mb-4">
            Your account has been disabled. Please contact an administrator if you believe this is an error.
          </p>
          <Button variant="outline" onClick={() => signOut()}>Sign Out</Button>
        </div>
      </div>
    );
  }

  // Check role access
  if (allowedRoles && !allowedRoles.includes(authUser.role)) {
    // In preview mode, allow ADMIN/OPS through CLIENT routes
    if (isPreviewMode && (authUser.role === 'ADMIN' || authUser.role === 'OPS') && allowedRoles.includes('CLIENT')) {
      // Allow through
    } else if (authUser.role === 'CLIENT') {
      // If user only has coroast access (no place orders), go to member portal
      if (isCoroastMember && !authUser.canPlaceOrders) {
        return <Navigate to="/member-portal" replace />;
      }
      // Default to manufacturing portal
      return <Navigate to="/portal/new-order" replace />;
    } else {
      return <Navigate to="/dashboard" replace />;
    }
  }

  // CLIENT user on standard portal routes but is coroast-only — redirect to member portal
  if (authUser.role === 'CLIENT' && isCoroastMember && !authUser.canPlaceOrders && location.pathname.startsWith('/portal')) {
    return <Navigate to="/member-portal" replace />;
  }

  // ADMIN/OPS trying to access member portal — redirect away (unless preview mode)
  if (!isPreviewMode && (authUser.role === 'ADMIN' || authUser.role === 'OPS') && location.pathname.startsWith('/member-portal')) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
