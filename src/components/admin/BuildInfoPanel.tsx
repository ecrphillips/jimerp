import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Info, RefreshCw, Check, X, AlertTriangle } from 'lucide-react';

// Build-time injected values
declare const __BUILD_TIMESTAMP__: string;
declare const __BUILD_MODE__: string;

interface EnvCheck {
  name: string;
  present: boolean;
  value?: string;
}

interface ServiceWorkerInfo {
  registered: boolean;
  scriptURL?: string;
  state?: string;
}

export function BuildInfoPanel() {
  const [swInfo, setSwInfo] = useState<ServiceWorkerInfo>({ registered: false });
  const [lastDeployTimestamp, setLastDeployTimestamp] = useState<string | null>(null);

  // Detect app mode from hostname
  const hostname = window.location.hostname;
  const isPreview = hostname.includes('preview') || hostname.includes('localhost') || hostname.includes('127.0.0.1');
  const appMode = isPreview ? 'preview' : 'published';

  // Environment variable checks
  const envChecks: EnvCheck[] = [
    {
      name: 'SUPABASE_URL',
      present: !!import.meta.env.VITE_SUPABASE_URL,
      value: import.meta.env.VITE_SUPABASE_URL ? '✓ Set' : undefined,
    },
    {
      name: 'SUPABASE_ANON_KEY',
      present: !!import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      value: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ? '✓ Set' : undefined,
    },
    {
      name: 'SUPABASE_PROJECT_ID',
      present: !!import.meta.env.VITE_SUPABASE_PROJECT_ID,
      value: import.meta.env.VITE_SUPABASE_PROJECT_ID || undefined,
    },
  ];

  // Edge function base URL
  const edgeFunctionBaseUrl = import.meta.env.VITE_SUPABASE_URL 
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
    : 'Not configured';

  // Build timestamp (fallback to localStorage deploy timestamp)
  let buildTimestamp: string;
  try {
    buildTimestamp = typeof __BUILD_TIMESTAMP__ !== 'undefined' ? __BUILD_TIMESTAMP__ : 'Unknown';
  } catch {
    buildTimestamp = 'Unknown';
  }

  let buildMode: string;
  try {
    buildMode = typeof __BUILD_MODE__ !== 'undefined' ? __BUILD_MODE__ : 'Unknown';
  } catch {
    buildMode = 'Unknown';
  }

  // Check service worker status
  useEffect(() => {
    const checkServiceWorker = async () => {
      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration) {
            setSwInfo({
              registered: true,
              scriptURL: registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL,
              state: registration.active?.state || registration.waiting?.state || registration.installing?.state,
            });
          } else {
            setSwInfo({ registered: false });
          }
        } catch (err) {
          console.error('Error checking service worker:', err);
          setSwInfo({ registered: false });
        }
      } else {
        setSwInfo({ registered: false });
      }
    };

    checkServiceWorker();
  }, []);

  // Track deploy timestamp in localStorage
  useEffect(() => {
    const DEPLOY_KEY = 'jim_last_deploy_timestamp';
    const stored = localStorage.getItem(DEPLOY_KEY);
    
    // If build timestamp changed, update localStorage
    if (buildTimestamp !== 'Unknown' && buildTimestamp !== stored) {
      localStorage.setItem(DEPLOY_KEY, buildTimestamp);
      setLastDeployTimestamp(buildTimestamp);
    } else if (stored) {
      setLastDeployTimestamp(stored);
    }
  }, [buildTimestamp]);

  // Clear cache and reload
  const handleClearCacheReload = () => {
    // Clear localStorage
    localStorage.clear();
    // Clear sessionStorage
    sessionStorage.clear();
    // Force reload (bypassing cache)
    window.location.reload();
  };

  return (
    <Card className="border-blue-500/50 bg-blue-500/5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Info className="h-5 w-5 text-blue-500" />
          <CardTitle className="text-lg">Build Info</CardTitle>
          <Badge variant={isPreview ? 'secondary' : 'default'} className="ml-auto">
            {appMode.toUpperCase()}
          </Badge>
        </div>
        <CardDescription>
          Diagnostic information for debugging deployment issues
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* App Mode */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted-foreground">App Mode:</span>
          <span className="font-mono">
            {appMode === 'preview' ? (
              <Badge variant="secondary" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Preview
              </Badge>
            ) : (
              <Badge variant="default" className="gap-1 bg-green-600">
                <Check className="h-3 w-3" />
                Published
              </Badge>
            )}
          </span>
        </div>

        {/* Current URL */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted-foreground">Current URL:</span>
          <span className="font-mono text-xs break-all">{window.location.href}</span>
        </div>

        {/* Hostname */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted-foreground">Hostname:</span>
          <span className="font-mono text-xs">{hostname}</span>
        </div>

        {/* Build Timestamp */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted-foreground">Build Timestamp:</span>
          <span className="font-mono text-xs">{buildTimestamp}</span>
        </div>

        {/* Build Mode */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted-foreground">Build Mode:</span>
          <span className="font-mono text-xs">{buildMode}</span>
        </div>

        {/* Last Deploy (from localStorage) */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted-foreground">Last Deploy (cached):</span>
          <span className="font-mono text-xs">{lastDeployTimestamp || 'Not recorded'}</span>
        </div>

        {/* Supabase Project Ref */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted-foreground">Supabase Project:</span>
          <span className="font-mono text-xs">{import.meta.env.VITE_SUPABASE_PROJECT_ID || 'Not set'}</span>
        </div>

        {/* Environment Variables */}
        <div className="space-y-2">
          <span className="text-sm text-muted-foreground">Environment Variables:</span>
          <div className="grid gap-1 pl-2">
            {envChecks.map((check) => (
              <div key={check.name} className="flex items-center gap-2 text-xs">
                {check.present ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <X className="h-3 w-3 text-red-500" />
                )}
                <span className="font-mono">{check.name}</span>
                {check.value && <span className="text-muted-foreground">({check.value})</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Edge Function URL */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted-foreground">Edge Function Base:</span>
          <span className="font-mono text-xs break-all">{edgeFunctionBaseUrl}</span>
        </div>

        {/* Service Worker Status */}
        <div className="space-y-2">
          <span className="text-sm text-muted-foreground">Service Worker:</span>
          <div className="pl-2 text-xs">
            {swInfo.registered ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Check className="h-3 w-3 text-green-500" />
                  <span>Registered</span>
                </div>
                {swInfo.state && (
                  <div className="text-muted-foreground">State: {swInfo.state}</div>
                )}
                {swInfo.scriptURL && (
                  <div className="text-muted-foreground break-all">URL: {swInfo.scriptURL}</div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <X className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">No service worker registered</span>
              </div>
            )}
          </div>
        </div>

        {/* Clear Cache Button */}
        <Button 
          variant="outline" 
          onClick={handleClearCacheReload}
          className="w-full gap-2 border-blue-500 text-blue-600 hover:bg-blue-500/10"
        >
          <RefreshCw className="h-4 w-4" />
          Clear Local Cache + Reload
        </Button>
      </CardContent>
    </Card>
  );
}
