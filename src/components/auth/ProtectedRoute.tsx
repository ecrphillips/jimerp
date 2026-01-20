import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import type { AppRole } from '@/types/database';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, authUser, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // No role assigned yet
  if (!authUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="mx-4 max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
          <h2 className="mb-2 text-lg font-semibold">Account Pending</h2>
          <p className="text-muted-foreground">
            Your account is awaiting role assignment. Please contact an administrator.
          </p>
        </div>
      </div>
    );
  }

  // Check role access
  if (allowedRoles && !allowedRoles.includes(authUser.role)) {
    // Redirect to appropriate home based on role
    if (authUser.role === 'CLIENT') {
      return <Navigate to="/portal/new-order" replace />;
    } else {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
}
