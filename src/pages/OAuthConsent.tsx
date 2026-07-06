import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertCircle, Loader2 } from "lucide-react";
import homeIslandLogo from "@/assets/home-island-logo.png";

// Narrow typed wrapper — supabase.auth.oauth is beta
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
};

function oauthApi(): OAuthApi {
  return (supabase.auth as unknown as { oauth: OAuthApi }).oauth;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) {
        setError(error.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorizationId)
      : await api.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-hi-cream p-4 font-brand">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <img
            src={homeIslandLogo}
            alt="Home Island Coffee Partners"
            className="mb-4 w-[200px] sm:w-[240px] h-auto"
          />
        </div>
        <Card className="rounded-2xl border-hi-navy/10 bg-white shadow-[0_8px_30px_-12px_hsl(var(--hi-navy)/0.18)]">
          <CardHeader>
            <CardTitle className="text-hi-navy font-medium text-2xl">
              {details?.client?.name ? `Connect ${details.client.name}` : "Connect an app"}
            </CardTitle>
            <CardDescription className="text-hi-navy/60">
              This will let {details?.client?.name ?? "the app"} access Home Island Coffee Partners as you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {!details && !error && (
              <div className="flex items-center gap-2 text-sm text-hi-navy/70">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading authorization request…
              </div>
            )}
            {details && (
              <div className="flex gap-2">
                <Button
                  className="flex-1 bg-hi-steel-blue text-white hover:bg-hi-navy"
                  onClick={() => decide(true)}
                  disabled={busy}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 border-hi-navy/20 text-hi-navy hover:bg-hi-navy/5"
                  onClick={() => decide(false)}
                  disabled={busy}
                >
                  Deny
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
