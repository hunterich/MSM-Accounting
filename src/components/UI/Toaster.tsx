import React from 'react';
import { useToastStore } from '../../stores/useToastStore';

/**
 * Renders the app-wide toast stack. Mount once (in Layout); push toasts from
 * anywhere via `useToastStore().pushToast(message, type)`.
 *
 * z-index sits above the shared Modal (z-[1000]) so toasts stay visible while a
 * dialog is open.
 */
const Toaster = (): React.ReactElement | null => {
    const toasts = useToastStore((s) => s.toasts);
    const dismissToast = useToastStore((s) => s.dismissToast);

    if (toasts.length === 0) return null;

    return (
        <div className="fixed top-4 right-4 z-[1100] flex flex-col gap-2 pointer-events-none">
            {toasts.map((t) => (
                <div
                    key={t.id}
                    role="status"
                    onClick={() => dismissToast(t.id)}
                    className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-neutral-0 transition-all pointer-events-auto cursor-pointer ${
                        t.type === 'error' ? 'bg-danger-500' : 'bg-success-500'
                    }`}
                >
                    {t.message}
                </div>
            ))}
        </div>
    );
};

export default Toaster;
