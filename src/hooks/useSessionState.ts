import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useState that survives navigation for the life of the browser tab.
 *
 * A pricing sheet takes real effort to fill in, and losing it to a stray click
 * on the sidebar is the kind of thing that stops people trusting a tool. This
 * keeps working state in sessionStorage: it survives route changes, reloads and
 * back/forward, and clears when the tab closes — which is the scope of a
 * quoting session.
 *
 * Every access is guarded. sessionStorage throws in private-browsing modes and
 * when a quota is hit, and neither should be able to take the page down: a
 * failure to persist degrades to ordinary component state.
 */

function read<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // Unreadable or unparseable — a stale shape from an older build, most
    // likely. Start clean rather than crash on it.
    return fallback;
  }
}

export function useSessionState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const [value, setValue] = useState<T>(() => read(key, initial));

  // Skip the write triggered by the initial render: it would rewrite storage
  // with what was just read from it.
  const hydrated = useRef(false);
  // Skip the write that follows a clear, which would otherwise persist the
  // initial value straight back over the key just removed.
  const skipNextWrite = useRef(false);

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Out of quota or storage unavailable. The value still lives in React
      // state for this mount; only persistence is lost.
    }
  }, [key, value]);

  const clear = useCallback(() => {
    skipNextWrite.current = true;
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Nothing to do — the reset below is what the caller actually wanted.
    }
    setValue(initial);
    // `initial` is intentionally not a dependency: callers pass literals, and
    // depending on it would rebuild this callback on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, setValue, clear];
}
