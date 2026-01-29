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

  // Step 1: Check for existing roast group with same display name
  const existingKey = await findExistingRoastGroup(displayName);
  
  if (existingKey) {
    console.log(`[RoastGroup] Reusing existing roast group: ${existingKey}`);
    return {
      roastGroupKey: existingKey,
      created: false,
    };
  }

  // Step 2: Generate deterministic system key
  const systemKey = generateSystemKey(displayName);
  const code = generateRoastGroupCode(displayName);

  // Step 3: Attempt to create (single attempt, no retries)
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

  if (error) {
    // Check if it's a unique constraint violation
    if (error.code === '23505') {
      // Could be system_key or code collision
      // Since display_name is the source of truth and it didn't match above,
      // this means a stale system_key exists. Provide clear error.
      const message = error.message?.toLowerCase() ?? '';
      
      if (message.includes('roast_group_pkey') || message.includes('roast_groups_pkey')) {
        return {
          roastGroupKey: '',
          created: false,
          error: `A roast group with system key "${systemKey}" already exists but has a different display name. Please use a more distinct name.`,
        };
      }
      
      if (message.includes('roast_group_code')) {
        return {
          roastGroupKey: '',
          created: false,
          error: `A roast group with code "${code}" already exists. Please use a more distinct name.`,
        };
      }

      return {
        roastGroupKey: '',
        created: false,
        error: `A roast group with a similar identifier already exists. Please use a more distinct name.`,
      };
    }

    // Other error
    return {
      roastGroupKey: '',
      created: false,
      error: error.message || 'Failed to create roast group',
    };
  }

  console.log(`[RoastGroup] Created new roast group: ${systemKey} (${displayName})`);
  return {
    roastGroupKey: systemKey,
    created: true,
  };
}

/**
 * Validates that a display name can be used for a new roast group.
 * Returns an error message if invalid, null if valid.
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

  // Check if it would conflict with existing
  const existingKey = await findExistingRoastGroup(trimmed);
  
  if (existingKey) {
    // Not an error - we'll reuse it
    return null;
  }

  // Check if system key would collide (but with different display name)
  const systemKey = generateSystemKey(trimmed);
  
  const { data } = await supabase
    .from('roast_groups')
    .select('roast_group, display_name')
    .eq('roast_group', systemKey)
    .limit(1);

  if (data && data.length > 0) {
    return `System key "${systemKey}" is already used by "${data[0].display_name}". Please use a more distinct name.`;
  }

  return null;
}
