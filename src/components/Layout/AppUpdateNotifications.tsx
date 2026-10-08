import React, { useEffect, useRef, useState } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { translate } from '../../i18n/language';
import { APP_UPDATES, parseReadUpdates, updateReadKey } from '../../lib/appUpdates';

export default function AppUpdateNotifications(): React.ReactElement {
    const userId = useAuthStore(s => s.user?.id);
    const language = useLanguageStore(s => s.language) ?? 'en';
    const t = (text: string) => translate(language, text);
    const [read, setRead] = useState<string[]>([]);
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const dialog = useRef<HTMLDialogElement>(null);
    const key = userId ? updateReadKey(userId) : null;
    useEffect(() => {
        const load = () => {
            try { setRead(key ? parseReadUpdates(localStorage.getItem(key)) : []); }
            catch { setRead([]); }
        };
        load();
        setLoadedKey(key);
        const sync = (event: StorageEvent) => { if (event.key === key || event.key === null) load(); };
        window.addEventListener('storage', sync);
        return () => window.removeEventListener('storage', sync);
    }, [key]);
    useEffect(() => {
        if (key && loadedKey === key && APP_UPDATES.some(update => !read.includes(update.id))) setOpen(true);
    }, [key, loadedKey]);
    useEffect(() => {
        if (open && !dialog.current?.open) dialog.current?.showModal();
        if (!open && dialog.current?.open) dialog.current?.close();
    }, [open]);
    const unread = APP_UPDATES.filter(update => !read.includes(update.id)).length;
    const markRead = () => {
        const ids = [...new Set([...read, ...APP_UPDATES.map(update => update.id)])];
        setRead(ids);
        try { if (key) localStorage.setItem(key, JSON.stringify(ids)); } catch { /* Still acknowledge for this session. */ }
    };
    const dismiss = () => { markRead(); setOpen(false); };
    return <>
        <div className="fixed right-4 top-3 z-[55] text-white md:static md:text-inherit">
            <button type="button" className="acc-topbar-icon relative max-md:text-white" onClick={() => setOpen(true)}
                aria-label={t('What’s new')} title={t('What’s new')} aria-haspopup="dialog">
                <Bell size={15} />
                {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary-600 px-0.5 text-[9px] text-white"
                    aria-label={t('Unread updates')}>{unread}</span>}
            </button>
        </div>
        <dialog ref={dialog} onClose={() => setOpen(false)} onCancel={event => { event.preventDefault(); dismiss(); }} aria-labelledby="app-updates-title"
            className="m-auto max-h-[85vh] w-[90vw] max-w-xl overflow-y-auto rounded-xl border border-neutral-200 bg-neutral-0 p-0 text-neutral-900 shadow-xl backdrop:bg-black/50">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
                <h2 id="app-updates-title" className="text-lg font-semibold">{t('What’s new')}</h2>
                <button type="button" onClick={dismiss} aria-label={t('Close')}
                    className="rounded p-1 hover:bg-neutral-100"><X size={20} /></button>
            </div>
            <div className="space-y-5 px-5 py-4">
                <p className="text-sm text-neutral-600">{t('Updates included in this app version.')}</p>
                {APP_UPDATES.map(update => <article key={update.id}>
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{t(update.title)}</h3>
                        {!read.includes(update.id) && <span className="rounded bg-primary-100 px-2 py-0.5 text-xs text-primary-700">{t('New')}</span>}
                    </div>
                    <p className="mt-1 text-xs text-neutral-500"><time dateTime={update.date}>{update.date}</time> · {t('Version')} {update.id}</p>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
                        {update.changes.map(change => <li key={change}>{t(change)}</li>)}
                    </ul>
                </article>)}
            </div>
            <div className="flex justify-end border-t border-neutral-200 px-5 py-3">
                <button type="button" onClick={dismiss}
                    className="flex items-center gap-2 rounded bg-primary-600 px-3 py-2 text-sm text-white">
                    <Check size={15} /> {t('Got it')}
                </button>
            </div>
        </dialog>
    </>;
}
