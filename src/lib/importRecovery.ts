/** Recovery is scoped to both actor and company; it never authorizes a retry. */
export function importRecoveryKey(userId: string, orgId: string): string {
  return `msm-invoice-import:${encodeURIComponent(userId)}:${encodeURIComponent(orgId)}`;
}

export function readImportRecovery<T>(key: string): T | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    return saved?.version === 1 ? saved.data as T : null;
  } catch { return null; }
}

export function writeImportRecovery(key: string, data: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify({ version: 1, data })); return true; }
  catch {
    window.dispatchEvent(new Event('msm:draft-storage-failed'));
    return false;
  }
}
