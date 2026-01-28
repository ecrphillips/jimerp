import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Coffee, Loader2 } from 'lucide-react';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get token info from URL hash (Supabase puts tokens in hash fragment)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const type = hashParams.get('type');
        
        // Also check query params for error cases
        const errorDescription = searchParams.get('error_description');
        if (errorDescription) {
          setError(errorDescription);
          return;
        }

        console.log('[AuthCallback] Token type:', type);

        // If we have tokens in the hash, set the session
        if (accessToken && refreshToken) {
          const { data, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (sessionError) {
            console.error('[AuthCallback] Session error:', sessionError);
            setError(sessionError.message);
            return;
          }

          // Check if this is an invite (type=invite or type=signup) - user needs to set password
          if (type === 'invite' || type === 'signup' || type === 'recovery') {
            console.log('[AuthCallback] Invite/recovery flow - redirecting to set password');
            navigate('/auth/set-password', { replace: true });
            return;
          }

          // Regular login flow - check user role and redirect appropriately
          if (data.user) {
            const { data: roleData } = await supabase
              .from('user_roles')
              .select('role')
              .eq('user_id', data.user.id)
              .single();

            if (roleData?.role === 'CLIENT') {
              navigate('/portal', { replace: true });
            } else {
              navigate('/production', { replace: true });
            }
            return;
          }
        }

        // No tokens - check if already logged in
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data: roleData } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', session.user.id)
            .single();

          if (roleData?.role === 'CLIENT') {
            navigate('/portal', { replace: true });
          } else {
            navigate('/production', { replace: true });
          }
          return;
        }

        // No session, no tokens - redirect to login
        navigate('/auth', { replace: true });
      } catch (err) {
        console.error('[AuthCallback] Error:', err);
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    };

    handleCallback();
  }, [navigate, searchParams]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center">
          <div className="mb-8 flex flex-col items-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <Coffee className="h-8 w-8 text-destructive" />
            </div>
            <h1 className="text-2xl font-bold text-destructive">Link Expired</h1>
            <p className="mt-2 text-muted-foreground">
              This link has expired or is invalid.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              Please contact your administrator to request a new invite link.
            </p>
            <button
              onClick={() => navigate('/auth')}
              className="mt-6 text-sm text-primary underline hover:text-primary/80"
            >
              Return to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Verifying your account...</p>
      </div>
    </div>
  );
}
