export const ORIGIN_TOP = [
  'Brazil',
  'Colombia',
  'Ethiopia',
  'Guatemala',
  'Honduras',
  'Kenya',
  'Peru',
  'Rwanda',
] as const;

export const ORIGIN_SECONDARY = [
  'Bolivia',
  'China',
  'Costa Rica',
  'El Salvador',
  'India',
  'Indonesia',
  'Mexico',
  'Nicaragua',
  'Panama',
  'Papua New Guinea',
  'Tanzania',
  'Uganda',
] as const;

export const ORIGIN_GROUPS: ReadonlyArray<{ label: string; options: readonly string[] }> = [
  { label: 'Common', options: ORIGIN_TOP },
  { label: 'Other origins', options: ORIGIN_SECONDARY },
];

export const ORIGIN_CUSTOM_SENTINEL = '__custom__';

export const ALL_KNOWN_ORIGINS = new Set<string>([...ORIGIN_TOP, ...ORIGIN_SECONDARY]);

export function isKnownOrigin(value: string | null | undefined): boolean {
  if (!value) return false;
  return ALL_KNOWN_ORIGINS.has(value);
}
