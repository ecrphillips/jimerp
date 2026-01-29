import React, { useMemo } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { generateShortCode } from '@/lib/skuUtils';

interface RoastGroupPreviewProps {
  /** The display name that will be shown for the roast group */
  displayName: string;
  /** Set of existing roast group system keys (uppercase) */
  existingKeys: Set<string>;
  /** Set of existing roast group codes (uppercase) */
  existingCodes: Set<string>;
}

/**
 * Resolves roast group key collisions and returns final key/code that would be saved.
 * This is purely for UI preview - actual collision resolution happens server-side.
 */
export function resolveRoastGroupKeyCollisions(
  displayName: string,
  existingKeys: Set<string>,
  existingCodes: Set<string>
): { 
  finalKey: string; 
  finalCode: string; 
  wasAdjusted: boolean 
} {
  // Clean up the key the same way as roastGroupCreation.ts
  const baseKey = displayName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, ''); // Trim leading/trailing underscores
  const baseCode = generateShortCode(displayName, 6);
  
  // Check if base key is available
  if (!existingKeys.has(baseKey) && !existingCodes.has(baseCode.toUpperCase())) {
    return { finalKey: baseKey, finalCode: baseCode, wasAdjusted: false };
  }
  
  // Show what suffix would be applied (for preview only)
  for (let i = 2; i <= 25; i++) {
    const candidateKey = `${baseKey}_${i}`;
    const candidateCode = `${baseCode}${i}`.substring(0, 6);
    
    if (!existingKeys.has(candidateKey) && !existingCodes.has(candidateCode.toUpperCase())) {
      return { finalKey: candidateKey, finalCode: candidateCode, wasAdjusted: true };
    }
  }
  
  // Fallback preview (actual creation will handle this)
  return { 
    finalKey: `${baseKey}_N`, 
    finalCode: `${baseCode.substring(0, 5)}N`, 
    wasAdjusted: true 
  };
}

/**
 * Preview of roast group that will be created (display name + system key)
 */
export function RoastGroupPreview({ 
  displayName, 
  existingKeys, 
  existingCodes 
}: RoastGroupPreviewProps) {
  const resolved = useMemo(() => {
    if (!displayName.trim()) return null;
    return resolveRoastGroupKeyCollisions(displayName, existingKeys, existingCodes);
  }, [displayName, existingKeys, existingCodes]);
  
  if (!displayName.trim()) {
    return null;
  }
  
  if (!resolved) return null;
  
  return (
    <div className="mt-3 p-3 border rounded-lg bg-muted/30 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Roast Group Preview</p>
        {resolved.wasAdjusted ? (
          <div className="flex items-center gap-1 text-xs text-warning">
            <AlertCircle className="h-3 w-3" />
            <span>Key adjusted</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="h-3 w-3" />
            <span>Unique</span>
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-muted-foreground">Display Name:</span>
          <p className="font-medium truncate" title={displayName}>{displayName}</p>
        </div>
        <div>
          <span className="text-muted-foreground">System Key:</span>
          <code className={`block font-mono text-[10px] px-1.5 py-0.5 rounded truncate ${
            resolved.wasAdjusted 
              ? 'bg-warning/20 text-warning-foreground border border-warning/30' 
              : 'bg-muted'
          }`} title={resolved.finalKey}>
            {resolved.finalKey}
          </code>
        </div>
      </div>
    </div>
  );
}
