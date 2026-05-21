import { useCallback, useRef, useState } from 'react';
import type { UndoEntry } from './types';

export function useUndoStack() {
  const stackRef = useRef<UndoEntry[]>([]);
  const [size, setSize] = useState(0);

  const push = useCallback((entry: UndoEntry) => {
    stackRef.current.push(entry);
    setSize(stackRef.current.length);
  }, []);

  const pop = useCallback((): UndoEntry | undefined => {
    const entry = stackRef.current.pop();
    setSize(stackRef.current.length);
    return entry;
  }, []);

  const peek = useCallback((): UndoEntry | undefined => {
    return stackRef.current[stackRef.current.length - 1];
  }, []);

  const clear = useCallback(() => {
    stackRef.current = [];
    setSize(0);
  }, []);

  return { push, pop, peek, clear, size };
}
