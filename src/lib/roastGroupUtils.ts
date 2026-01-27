/**
 * Returns the display name for a roast group.
 * Falls back to the roast_group key if display_name is not set.
 */
export function getDisplayName(
  displayName: string | null | undefined,
  roastGroup: string
): string {
  return displayName?.trim() || roastGroup.replace(/_/g, ' ');
}
