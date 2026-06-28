// src/components/workspace/TabCapPrompt.tsx
import React from 'react';
import { X } from 'lucide-react';
import Modal from '../UI/Modal';
import Button from '../UI/Button';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { TAB_CAP } from '../../stores/workspace/types';

/**
 * Shown when opening a tab is blocked by the cap. Instead of dead-ending the
 * user (the old window.alert), we let them pick a tab to close — which both
 * frees a slot and opens the document they were trying to reach.
 */
const TabCapPrompt = (): React.ReactElement | null => {
    const capPrompt = useWorkspaceStore((s) => s.capPrompt);
    const tabs = useWorkspaceStore((s) => s.tabs);
    const resolveCapPrompt = useWorkspaceStore((s) => s.resolveCapPrompt);
    const dismissCapPrompt = useWorkspaceStore((s) => s.dismissCapPrompt);

    if (!capPrompt) return null;

    const confirmIfDirty = (dirty: boolean) =>
        !dirty || window.confirm('That tab has unsaved changes. Close it and discard them?');

    const closeAndOpen = (id: string, dirty: boolean) => {
        if (confirmIfDirty(dirty)) resolveCapPrompt(id);
    };

    // "Close oldest" prefers the oldest clean tab so we don't silently drop edits.
    const oldestClean = tabs.find((t) => t.status === 'clean') ?? tabs[0];

    return (
        <Modal isOpen onClose={dismissCapPrompt} size="sm" title={`You have ${TAB_CAP} tabs open`}>
            <p className="text-sm text-neutral-600 m-0 mb-4">
                Close a tab to open <span className="font-semibold text-neutral-800">“{capPrompt.title}”</span>.
            </p>

            <ul className="m-0 mb-5 p-0 list-none max-h-64 overflow-y-auto border border-neutral-200 rounded-lg divide-y divide-neutral-100">
                {tabs.map((t) => (
                    <li key={t.id}>
                        <button
                            type="button"
                            onClick={() => closeAndOpen(t.id, t.status !== 'clean')}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50 transition-colors"
                            title={`Close “${t.title}” and open “${capPrompt.title}”`}
                        >
                            {t.status !== 'clean' && (
                                <span className="w-1.5 h-1.5 rounded-full bg-warning-500 shrink-0" aria-label="unsaved changes" />
                            )}
                            <span className="truncate flex-1 text-neutral-800">{t.title}</span>
                            <X size={15} className="text-neutral-400 shrink-0" />
                        </button>
                    </li>
                ))}
            </ul>

            <div className="flex justify-end gap-2">
                <Button text="Cancel" variant="secondary" size="small" onClick={dismissCapPrompt} />
                {oldestClean && (
                    <Button
                        text="Close oldest & open"
                        variant="primary"
                        size="small"
                        onClick={() => closeAndOpen(oldestClean.id, oldestClean.status !== 'clean')}
                    />
                )}
            </div>
        </Modal>
    );
};

export default TabCapPrompt;
