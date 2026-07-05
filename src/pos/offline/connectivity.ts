import { useEffect, useState } from 'react';

/** Resolve true if the ping succeeds (real connectivity), false otherwise. */
export async function probeOnline(ping: () => Promise<unknown>): Promise<boolean> {
  try { await ping(); return true; } catch { return false; }
}

/** React hook: navigator.onLine + online/offline events. */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
