import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/apiClient';
import { isWithinAccessSchedule, type AccessScheduleStatus } from '../../../lib/access-schedule';
import { DRAFT_FLUSH_EVENT, SCHEDULE_DENIED_EVENT, useAccessScheduleStore } from '../../stores/useAccessScheduleStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLanguageStore } from '../../stores/useLanguageStore';
import CompanySwitcher from '../Layout/CompanySwitcher';

/** Keep forms and import promises mounted while blocking all new interaction. */
export default function AccessScheduleBoundary({ children }: { children: React.ReactNode }) {
  const { status: cachedStatus, context, receivedAt, denied, pendingWrites, update } = useAccessScheduleStore();
  const [, setTick] = useState(0);
  const [error, setError] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const orgId = useAuthStore(s => s.org?.id);
  const userId = useAuthStore(s => s.user?.id);
  const contextKey = `${userId}:${orgId}`;
  const status = context === contextKey ? cachedStatus : null;
  const logout = useAuthStore(s => s.logout);
  const id = useLanguageStore(s => s.language) === 'id';
  const loading = useRef(false);
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const result = await api.get<AccessScheduleStatus>('/api/v1/access-schedule');
      if (typeof result.allowed !== 'boolean' || !result.serverNow || !result.schedule) throw new Error('Invalid schedule response');
      const current = useAuthStore.getState();
      if (`${current.user?.id}:${current.org?.id}` !== contextKey) return;
      update(result, contextKey);
      setError(false);
    } catch { setError(true); }
    finally { loading.current = false; }
  }, [update, contextKey]);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => void refresh(), 30_000);
    const clock = window.setInterval(() => setTick(t => t + 1), 1000);
    const check = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    window.addEventListener(SCHEDULE_DENIED_EVENT, check);
    const storageError = () => setStorageFailed(true);
    window.addEventListener('msm:draft-storage-failed', storageError);
    return () => {
      clearInterval(poll); clearInterval(clock);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener(SCHEDULE_DENIED_EVENT, check);
      window.removeEventListener('msm:draft-storage-failed', storageError);
    };
  }, [refresh, orgId]);

  // Advance the server's clock using monotonic elapsed time, unaffected by a
  // user changing their computer's date. The server always makes the real decision.
  const now = new Date(status ? Date.parse(status.serverNow) + performance.now() - receivedAt : 0);
  const within = !!status && (status.exempt || isWithinAccessSchedule(status.schedule, status.timezone, now));
  const locked = !within || denied;
  const warning = within && !status!.exempt && !isWithinAccessSchedule(status!.schedule, status!.timezone, new Date(now.getTime() + 300_000));
  useEffect(() => {
    if (locked) {
      window.dispatchEvent(new Event(DRAFT_FLUSH_EVENT));
      // Move focus away from the now-inert form, including open import modals.
      document.getElementById('access-schedule-heading')?.focus();
    }
  }, [locked]);
  useEffect(() => {
    if (!locked) return;
    // Existing modals subscribe to Escape on window. Do not let a key press
    // behind the lock close/reset an unfinished import.
    const guard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', guard, true);
    return () => window.removeEventListener('keydown', guard, true);
  }, [locked]);

  return <>
    <div inert={locked} aria-hidden={locked || undefined}>{children}</div>
    {warning && !locked && <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[2500] rounded-lg border border-amber-400 bg-amber-50 p-4 text-amber-950 shadow-lg">
      {id ? 'Akses berakhir dalam 5 menit. Simpan pekerjaan Anda.' : 'Access ends within 5 minutes. Save your work.'} ({status!.timezone})
    </div>}
    {locked && <div role="dialog" aria-modal="true" aria-labelledby="access-schedule-heading" className="fixed inset-0 z-[3000] flex items-center justify-center bg-neutral-100/95 p-6">
      <div className="w-full max-w-xl rounded-xl border border-neutral-300 bg-white p-6 shadow-xl">
        <h1 id="access-schedule-heading" tabIndex={-1} className="text-xl font-semibold">{!status
          ? (id ? 'Memeriksa jadwal akses…' : 'Checking access hours…')
          : (id ? 'Di luar jam akses Anda' : 'Outside your access hours')}</h1>
        <p className="mt-3 text-sm">{id
          ? 'Formulir tetap terbuka. Draf faktur ruang kerja disimpan di browser ini jika penyimpanan tersedia. Pekerjaan dapat dilanjutkan pada jam akses berikutnya. Ini bukan penyimpanan Draf ke server.'
          : 'Your forms remain open. Workspace invoice drafts are preserved in this browser when storage is available. Resume during your next access window. This does not save a Draft invoice to the server.'}</p>
        <p className="mt-3 text-sm">{id
          ? 'Penyimpanan dan impor yang sudah diterima server tetap diselesaikan. Jangan tutup halaman selama proses berlangsung.'
          : 'Saves and imports already accepted by the server can finish. Keep this page open while they run.'} {pendingWrites > 0 && `(${pendingWrites})`}</p>
        {status && <p className="mt-3 text-sm text-neutral-600">{status.timezone}: {Array.isArray(status.schedule.allowedDays) && status.schedule.allowedDays.length ? status.schedule.allowedDays.join(', ') : (id ? 'Setiap hari' : 'Every day')} · {status.schedule.startTime || '00:00'}–{status.schedule.endTime || '24:00'}</p>}
        {storageFailed && <p role="alert" className="mt-3 text-sm text-red-700">{id ? 'Penyimpanan browser gagal. Jangan tutup halaman ini; input tetap ada selama halaman terbuka.' : 'Browser storage failed. Keep this page open; your input remains in the open form.'}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{id ? 'Jadwal belum dapat diverifikasi. Coba lagi.' : 'Could not verify your schedule. Try again.'}</p>}
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button className="rounded bg-primary-700 px-4 py-2 text-white" onClick={() => void refresh()}>{id ? 'Periksa akses' : 'Check access'}</button>
          <CompanySwitcher />
          <button className="text-sm underline" disabled={pendingWrites > 0} onClick={() => { window.dispatchEvent(new Event(DRAFT_FLUSH_EVENT)); void logout(); }}>{id ? 'Keluar' : 'Logout'}</button>
        </div>
      </div>
    </div>}
  </>;
}
