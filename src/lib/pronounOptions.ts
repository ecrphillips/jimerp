// Common preferred-pronoun options for contact records.
// Internal admin/ops only; never exposed on client-facing surfaces.

export const PRONOUN_OPTIONS = [
  { value: 'she/her', label: 'she/her' },
  { value: 'he/him', label: 'he/him' },
  { value: 'they/them', label: 'they/them' },
  { value: 'she/they', label: 'she/they' },
  { value: 'he/they', label: 'he/they' },
  { value: 'other', label: 'Other (specify)' },
] as const;

const PRESET_VALUES: ReadonlySet<string> = new Set(
  PRONOUN_OPTIONS.filter((o) => o.value !== 'other').map((o) => o.value as string),
);

/** Returns true when the stored pronouns string is one of the preset options. */
export function isPresetPronoun(value: string | null | undefined): boolean {
  return !!value && PRESET_VALUES.has(value);
}

/**
 * Format pronouns for inline display after a name.
 * Returns "(he/him)" with leading space, or empty string when null/blank.
 */
export function formatPronounsSuffix(value: string | null | undefined): string {
  const v = value?.trim();
  return v ? ` (${v})` : '';
}
