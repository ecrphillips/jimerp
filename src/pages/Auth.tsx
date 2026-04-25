import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import homeIslandLogo from '@/assets/home-island-logo.png';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const emailSchema = z.object({
  email: z.string().email('Please enter a valid email'),
});

type InviteState = 'checking' | 'none' | 'ready' | 'invalid';

export default function Auth() {
  const { user, authUser, signIn, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(searchParams.get('forgot') === 'true');

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Forgot password state
  const [resetEmail, setResetEmail] = useState('');

  // Invite flow state
  const [inviteState, setInviteState] = useState<InviteState>('checking');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Detect & process invite token (hash-based implicit flow OR PKCE code in query)
  useEffect(() => {
    let cancelled = false;

    const processInvite = async () => {
      try {
        const hash = window.location.hash.startsWith('#')
          ? window.location.hash.substring(1)
          : '';
        const hashParams = new URLSearchParams(hash);
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const hashType = hashParams.get('type');
        const hashError = hashParams.get('error') || hashParams.get('error_description');

        const code = searchParams.get('code');
        const queryType = searchParams.get('type');
        const queryError = searchParams.get('error') || searchParams.get('error_description');

        const isInviteHash =
          !!accessToken && !!refreshToken && (hashType === 'invite' || hashType === 'signup' || hashType === 'recovery');
        const isInvitePkce = !!code && (queryType === 'invite' || queryType === 'signup' || queryType === 'recovery' || !queryType);

        // Surface explicit errors from Supabase redirect
        if (hashError || queryError) {
          if (!cancelled) setInviteState('invalid');
          return;
        }

        if (isInviteHash) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken!,
            refresh_token: refreshToken!,
          });
          if (sessionError) {
            if (!cancelled) setInviteState('invalid');
            return;
          }
          // Clear hash so refresh doesn't re-trigger
          window.history.replaceState(null, '', window.location.pathname);
          if (!cancelled) setInviteState('ready');
          return;
        }

        if (isInvitePkce) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code!);
          if (exchangeError) {
            if (!cancelled) setInviteState('invalid');
            return;
          }
          window.history.replaceState(null, '', window.location.pathname);
          if (!cancelled) setInviteState('ready');
          return;
        }

        if (!cancelled) setInviteState('none');
      } catch {
        if (!cancelled) setInviteState('invalid');
      }
    };

    processInvite();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redirect if already logged in (but NOT during invite flow — they need to set a password first)
  useEffect(() => {
    if (inviteState === 'ready' || inviteState === 'checking') return;
    if (user && authUser) {
      const from = (location.state as { from?: Location })?.from?.pathname;
      if (from) {
        navigate(from, { replace: true });
      } else if (authUser.role === 'CLIENT') {
        navigate('/portal', { replace: true });
      } else {
        navigate('/production', { replace: true });
      }
    }
  }, [user, authUser, navigate, location, inviteState]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const validation = loginSchema.safeParse({ email: loginEmail, password: loginPassword });
      if (!validation.success) {
        setError(validation.error.errors[0].message);
        setIsSubmitting(false);
        return;
      }

      const { error } = await signIn(loginEmail, loginPassword);
      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setError('Invalid email or password');
        } else {
          setError(error.message);
        }
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const validation = emailSchema.safeParse({ email: resetEmail });
      if (!validation.success) {
        setError(validation.error.errors[0].message);
        setIsSubmitting(false);
        return;
      }

      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/auth/callback`,
      });

      if (error) {
        setError(error.message);
      } else {
        setSuccess('Password reset link sent! Check your email inbox.');
        setResetEmail('');
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetInvitePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (newPassword.length < 8) {
        setError('Password must be at least 8 characters');
        setIsSubmitting(false);
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('Passwords do not match');
        setIsSubmitting(false);
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setError(updateError.message);
        setIsSubmitting(false);
        return;
      }

      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading: either auth context loading OR we're still checking the invite token
  if (loading || inviteState === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const isInviteFlow = inviteState === 'ready' || inviteState === 'invalid';

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary">
            <Coffee className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">JIM</h1>
          <p className="text-muted-foreground">by Home Island Software</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            {isInviteFlow ? (
              <>
                <CardTitle>Welcome to JIM</CardTitle>
                <CardDescription>
                  Set a password to activate your account.
                </CardDescription>
              </>
            ) : showForgotPassword ? (
              <>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8"
                    onClick={() => {
                      setShowForgotPassword(false);
                      setError(null);
                      setSuccess(null);
                    }}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <CardTitle>Reset Password</CardTitle>
                </div>
                <CardDescription>
                  Enter your email to receive a password reset link.
                </CardDescription>
              </>
            ) : (
              <>
                <CardTitle>Welcome Back</CardTitle>
                <CardDescription>
                  Sign in to your account to continue.
                </CardDescription>
              </>
            )}
          </CardHeader>

          <CardContent>
            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {success && (
              <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-800">
                {success}
              </div>
            )}

            {inviteState === 'invalid' ? (
              <>
                <div className="mb-4 flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>This invite link has expired or is invalid. Please contact Home Island to be re-invited.</span>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setInviteState('none');
                  }}
                >
                  Return to sign in
                </Button>
              </>
            ) : inviteState === 'ready' ? (
              <form onSubmit={handleSetInvitePassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">Choose a password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={isSubmitting}
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={isSubmitting}
                    autoComplete="new-password"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Activating...
                    </>
                  ) : (
                    'Activate Account'
                  )}
                </Button>
              </form>
            ) : showForgotPassword ? (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="you@example.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    disabled={isSubmitting}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Send Reset Link'
                  )}
                </Button>
              </form>
            ) : (
              <>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="you@example.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      disabled={isSubmitting}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      disabled={isSubmitting}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      'Sign In'
                    )}
                  </Button>
                </form>

                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotPassword(true);
                      setError(null);
                    }}
                    className="text-sm text-muted-foreground hover:text-primary hover:underline"
                  >
                    Forgot your password?
                  </button>
                </div>

                <div className="mt-6 rounded-md bg-muted p-4">
                  <p className="text-center text-sm text-muted-foreground">
                    <strong>Don't have an account?</strong>
                    <br />
                    Accounts are created by Home Island. Check your email for an invite link.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
