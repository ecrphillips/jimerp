import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';

// Build-time injected values
declare const __BUILD_TIMESTAMP__: string;
declare const __BUILD_MODE__: string;

export function EnvironmentFooter() {
  const { authUser } = useAuth();
  
  // Only show when ?debug=true is in URL AND user is ADMIN/OPS
  const isAdminOrOps = authUser?.role === 'ADMIN' || authUser?.role === 'OPS';
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const debugMode = urlParams?.get('debug') === 'true';
  
  if (!isAdminOrOps || !debugMode) return null;

  // Get environment info
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const isPreview = hostname.includes('preview') || hostname.includes('localhost') || hostname.includes('127.0.0.1');
  
  // Parse Supabase project ref from URL
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const supabaseProjectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || 'unknown';
  
  // Build timestamp
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

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-t border-border px-4 py-1.5 text-xs font-mono flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <Badge variant={isPreview ? 'secondary' : 'default'} className="text-[10px] h-5">
          {isPreview ? 'PREVIEW' : 'PUBLISHED'}
        </Badge>
        <span className="text-muted-foreground">
          Build: <span className="text-foreground">{buildTimestamp}</span>
        </span>
        <span className="text-muted-foreground">
          Mode: <span className="text-foreground">{buildMode}</span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">
          Supabase: <span className="text-foreground">{supabaseProjectRef}</span>
        </span>
        <span className="text-muted-foreground">
          Host: <span className="text-foreground">{hostname}</span>
        </span>
      </div>
    </div>
  );
}
