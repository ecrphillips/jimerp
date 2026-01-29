/**
 * Roast Group Creation Utilities
 * 
 * Handles deterministic creation and reuse of roast groups.
 * No retry loops - fail fast with clear errors.
 */

import { supabase } from '@/integrations/supabase/client';
import { generateShortCode } from './skuUtils';

export interface RoastGroupCreateParams {
  displayName: string;
  isBlend: boolean;
  origin?: string | null;
  blendName?: string | null;
  cropsterProfileRef?: string | null;
  notes?: string | null;
}

export interface RoastGroupResult {
  roastGroupKey: string;
  created: boolean;
  error?: string;
}

/**
 * Generates a deterministic system key from a display name.
 * No random suffixes, no retries.
 */
export function generateSystemKey(displayName: string): string {
  return displayName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, ''); // Trim leading/trailing underscores
}

/**
 * Generates a short code (up to 6 chars) for the roast group.
 */
export function generateRoastGroupCode(displayName: string): string {
  return generateShortCode(displayName, 6);
}

/**
 * Attempts to find an existing roast group by display_name (case-insensitive).
 * Returns the roast_group key if found.
 */
export async function findExistingRoastGroup(
  displayName: string
): Promise<string | null> {
  const trimmed = displayName.trim();
  if (!trimmed) return null;

  // Query using case-insensitive match (display_name is citext)
  const { data, error } = await supabase
    .from('roast_groups')
    .select('roast_group')
    .ilike('display_name', trimmed)
    .eq('is_active', true)
    .limit(1);

  if (error) {
    console.error('Error checking for existing roast group:', error);
    return null;
  }

  return data?.[0]?.roast_group ?? null;
}

/**
 * Creates or reuses a roast group.
 * 
 * Logic:
 * 1. Check if roast group with same display_name exists → reuse it
 * 2. If not, create with deterministic system_key derived from display_name
 * 3. If system_key collision occurs at DB level, fail fast with clear error
 */
/**
 * Creates or reuses a roast group.
 * 
 * Logic:
 * 1. Check if roast group with EXACT same display_name exists (case-insensitive) → reuse it
 * 2. If not, create with system_key derived from display_name
 * 3. If system_key or code collides, auto-suffix (_2, _3, ...) until unique
 * 4. Only fail if we can't find a unique key after max attempts (very rare)
 */
export async function createOrReuseRoastGroup(
  params: RoastGroupCreateParams
): Promise<RoastGroupResult> {
  const displayName = params.displayName.trim();
  
  if (!displayName) {
    return {
      roastGroupKey: '',
      created: false,
      error: 'Display name is required',
    };
  }

  // Step 1: Check for EXACT existing roast group with same display name (case-insensitive)
  const existingKey = await findExistingRoastGroup(displayName);
  
  if (existingKey) {
    console.log(`[RoastGroup] Reusing existing roast group: ${existingKey}`);
    return {
      roastGroupKey: existingKey,
      created: false,
    };
  }

  // Step 2: Generate base system key and code
  const baseSystemKey = generateSystemKey(displayName);
  const baseCode = generateRoastGroupCode(displayName);

  // Step 3: Try to insert, auto-suffixing on collision
  const MAX_SUFFIX_ATTEMPTS = 25;
  
  for (let attempt = 0; attempt < MAX_SUFFIX_ATTEMPTS; attempt++) {
    const systemKey = attempt === 0 ? baseSystemKey : `${baseSystemKey}_${attempt + 1}`;
    const code = attempt === 0 ? baseCode : `${baseCode}${attempt + 1}`.substring(0, 6);
    
    const { error } = await supabase
      .from('roast_groups')
      .insert({
        roast_group: systemKey,
        roast_group_code: code,
        display_name: displayName,
        is_blend: params.isBlend,
        origin: params.origin ?? null,
        blend_name: params.blendName ?? null,
        standard_batch_kg: 20,
        expected_yield_loss_pct: 16,
        default_roaster: 'EITHER',
        is_active: true,
        cropster_profile_ref: params.cropsterProfileRef ?? null,
        notes: params.notes ?? null,
      });

    if (!error) {
      if (attempt > 0) {
        console.log(`[RoastGroup] Created new roast group with suffix: ${systemKey} (${displayName})`);
      } else {
        console.log(`[RoastGroup] Created new roast group: ${systemKey} (${displayName})`);
      }
      return {
        roastGroupKey: systemKey,
        created: true,
      };
    }

    // Check if it's a unique constraint violation - if so, try next suffix
    if (error.code === '23505') {
      console.log(`[RoastGroup] Key collision on attempt ${attempt + 1}, trying suffix...`);
      continue;
    }

    // Other error - fail fast
    return {
      roastGroupKey: '',
      created: false,
      error: error.message || 'Failed to create roast group',
    };
  }

  // Exhausted all suffix attempts (very rare - would need 25+ roast groups with same base name)
  return {
    roastGroupKey: '',
    created: false,
    error: `Could not create roast group "${displayName}" - too many similar system keys exist. Please use a more distinct name.`,
  };
}

/**
 * Validates that a display name can be used for a new roast group.
 * Returns an error message if invalid, null if valid.
 * 
 * Only blocks on EXACT display_name duplicates (case-insensitive).
 * System key collisions are handled automatically via suffixing during creation.
 */
export async function validateRoastGroupName(
  displayName: string
): Promise<string | null> {
  const trimmed = displayName.trim();
  
  if (!trimmed) {
    return 'Display name is required';
  }

  if (trimmed.length < 2) {
    return 'Display name must be at least 2 characters';
  }

  // Check for exact duplicate display_name (will be reused, so not an error)
  const existingKey = await findExistingRoastGroup(trimmed);
  
  if (existingKey) {
    // Not an error - we'll reuse it
    return null;
  }

  // No blocking validation for system_key - collisions are auto-resolved
  return null;
}
