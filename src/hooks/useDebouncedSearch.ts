import { useEffect, useState } from 'react';

/** Only search typing waits; other catalog filters and page changes stay immediate. */
export function useDebouncedSearch(value: string, delay = 300): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
