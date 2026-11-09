import { useEffect, useState } from 'react';

/** Typing in a search box should not fire one request per keystroke; with live data each one is a network call. */
export const SEARCH_DEBOUNCE_MS = 250;

/** Returns `value` once it has stopped changing for `delayMs`. The first render returns `value` immediately. */
export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
