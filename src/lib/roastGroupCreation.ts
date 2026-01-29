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

  // Step 3: Single insert attempt - exact key collision gets auto-suffixed
  // First try without suffix
  const { error: firstError } = await supabase
    .from('roast_groups')
    .insert({
      roast_group: baseSystemKey,
      roast_group_code: baseCode,
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

  if (!firstError) {
    console.log(`[RoastGroup] Created new roast group: ${baseSystemKey} (${displayName})`);
    return {
      roastGroupKey: baseSystemKey,
      created: true,
    };
  }

  // If not a unique constraint violation, fail fast with the actual error
  if (firstError.code !== '23505') {
    return {
      roastGroupKey: '',
      created: false,
      error: firstError.message || 'Failed to create roast group',
    };
  }

  // Unique constraint violation - try with numeric suffixes
  console.log(`[RoastGroup] Key "${baseSystemKey}" exists, trying suffixes...`);
  
  for (let suffix = 2; suffix <= 50; suffix++) {
    const systemKey = `${baseSystemKey}_${suffix}`;
    // Properly truncate base code to make room for suffix digits
    const suffixStr = String(suffix);
    const maxBaseLen = 6 - suffixStr.length;
    const code = `${baseCode.substring(0, maxBaseLen)}${suffixStr}`;
    
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
      console.log(`[RoastGroup] Created roast group with suffix: ${systemKey} (${displayName})`);
      return {
        roastGroupKey: systemKey,
        created: true,
      };
    }

    // If it's still a constraint violation, continue to next suffix
    if (error.code === '23505') {
      continue;
    }

    // Other error - fail fast
    return {
      roastGroupKey: '',
      created: false,
      error: error.message || 'Failed to create roast group',
    };
  }

  // This should essentially never happen (would need 50+ roast groups with identical base key)
  return {
    roastGroupKey: '',
    created: false,
    error: `Unable to create roast group - system key "${baseSystemKey}" has too many variants. Contact support.`,
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
