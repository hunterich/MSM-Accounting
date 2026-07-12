import { create } from 'zustand';

export type ToastType = 'success' | 'error';

export interface ToastAction {
    label: string;
    onClick: () => void;
}

export interface Toast {
    id: number;
    message: string;
    type: ToastType;
    action?: ToastAction;
}

interface ToastStore {
    toasts: Toast[];
    /** Show a transient toast. Auto-dismisses after 4s (8s with an action button). */
    pushToast: (message: string, type?: ToastType, action?: ToastAction) => void;
    dismissToast: (id: number) => void;
}

let toastSeq = 0;

/**
 * App-wide toast notifications. Call `pushToast` from anywhere; render a single
 * <Toaster /> (mounted in Layout) to display them. Not persisted — session-only.
 */
export const useToastStore = create<ToastStore>((set) => ({
    toasts: [],
    pushToast: (message, type = 'success', action) => {
        const id = ++toastSeq;
        set((state) => ({ toasts: [...state.toasts, { id, message, type, action }] }));
        setTimeout(() => {
            set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
        }, action ? 8000 : 4000);
    },
    dismissToast: (id) =>
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
