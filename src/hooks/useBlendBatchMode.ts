import { useSyncExternalStore } from 'react';

const key = 'partial-blend-exceptions';
let cachedRaw: string | null = null;
let cached: Record<string, boolean> = {};
function snapshot() {
  const raw = sessionStorage.getItem(key);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try { cached = JSON.parse(raw ?? '{}'); } catch { cached = {}; }
  }
  return cached;
}
function subscribe(callback: () => void) {
  window.addEventListener(key, callback);
  return () => window.removeEventListener(key, callback);
}
export function useBlendBatchModes() {
  return useSyncExternalStore(subscribe, snapshot);
}
export function useBlendBatchMode(roastGroup: string) {
  const modes = useBlendBatchModes();
  const setAllowPartial = (value: boolean) => {
    sessionStorage.setItem(key, JSON.stringify({ ...snapshot(), [roastGroup]: value }));
    window.dispatchEvent(new Event(key));
  };
  return [modes[roastGroup] === true, setAllowPartial] as const;
}