// src/components/workspace/TabCapPrompt.tsx
import React from 'react';
import { X } from 'lucide-react';
import Modal from '../UI/Modal';
import Button from '../UI/Button';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { TAB_CAP, MODULE_CAP } from '../../stores/workspace/types';
import { moduleKeyOf, docModuleTitle } from '../../stores/workspace/modules';

/**
 * Shown when opening a tab is blocked by a cap. The workspace has two
 * independent caps, so the prompt adapts:
 *  - 'doc'    — the target module already holds TAB_CAP tabs → pick a tab in
 *               that module to close.
 *  - 'module' — MODULE_CAP modules are open and this is a new one → pick a
 *               module to close.
 * Either way the user picks what to close and we open the blocked document.
 */
const TabCapPrompt = (): React.ReactElement | null => {
    const capPrompt = useWorkspaceStore((s) => s.capPrompt);
    const tabs = useWorkspaceStore((s) => s.tabs);
    const resolveCapPrompt = useWorkspaceStore((s) => s.resolveCapPrompt);
    const resolveCapPromptByModule = useWorkspaceStore((s) => s.resolveCapPromptByModule);
    const dismissCapPrompt = useWorkspaceStore((s) => s.dismissCapPrompt);

    if (!capPrompt) return null;

    const pendingKey = moduleKeyOf(capPrompt.target);
    const isDocCap = tabs.some((t) => moduleKeyOf(t.target) === pendingKey);

    const confirmIfDirty = (dirty: boolean) =>
        !dirty || window.confirm('That tab has unsaved changes. Close it and discard them?');

    // ── Module cap: list distinct open modules; closing one frees a slot ──────
    if (!isDocCap) {
        const modules: { key: string; title: string; dirty: boolean }[] = [];
        const seen = new Map<string, { key: string; title: string; dirty: boolean }>();
        for (const t of tabs) {
            const key = moduleKeyOf(t.target);
            const dirty = t.status !== 'clean';
            const existing = seen.get(key);
            if (existing) { if (dirty) existing.dirty = true; continue; }
            const m = { key, title: docModuleTitle(key) ?? t.title, dirty };
            seen.set(key, m);
            modules.push(m);
        }
        const closeModuleAndOpen = (key: string, dirty: boolean) => { if (confirmIfDirty(dirty)) resolveCapPromptByModule(key); };
        const oldest = modules[0];
        return (
            <Modal isOpen onClose={dismissCapPrompt} size="sm" title={`You have ${MODULE_CAP} modules open`}>
                <p className="text-sm text-neutral-600 m-0 mb-4">
                    Close a module to open <span className="font-semibold text-neutral-800">“{capPrompt.title}”</span>.
                </p>
                <ul className="m-0 mb-5 p-0 list-none max-h-64 overflow-y-auto border border-neutral-200 rounded-lg divide-y divide-neutral-100">
                    {modules.map((m) => (
                        <li key={m.key}>
                            <button type="button" onClick={() => closeModuleAndOpen(m.key, m.dirty)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50 transition-colors" title={`Close “${m.title}” and open “${capPrompt.title}”`}>
                                {m.dirty && <span className="w-1.5 h-1.5 rounded-full bg-warning-500 shrink-0" aria-label="unsaved changes" />}
                                <span className="truncate flex-1 text-neutral-800">{m.title}</span>
                                <X size={15} className="text-neutral-400 shrink-0" />
                            </button>
                        </li>
                    ))}
                </ul>
                <div className="flex justify-end gap-2">
                    <Button text="Cancel" variant="secondary" size="small" onClick={dismissCapPrompt} />
                    {oldest && <Button text="Close oldest module & open" variant="primary" size="small" onClick={() => closeModuleAndOpen(oldest.key, oldest.dirty)} />}
                </div>
            </Modal>
        );
    }

    // ── Doc cap: list the target module's document tabs (catalog excluded —
    //    it doesn't hold a doc slot); closing one frees a slot. ──────────────
    const moduleTabs = tabs.filter((t) => moduleKeyOf(t.target) === pendingKey && t.kind !== 'list');
    const moduleTitle = docModuleTitle(pendingKey) ?? moduleTabs[0]?.title ?? 'this area';
    const closeAndOpen = (id: string, dirty: boolean) => { if (confirmIfDirty(dirty)) resolveCapPrompt(id); };
    const oldestClean = moduleTabs.find((t) => t.status === 'clean') ?? moduleTabs[0];

    return (
        <Modal isOpen onClose={dismissCapPrompt} size="sm" title={`“${moduleTitle}” already has ${TAB_CAP} tabs`}>
            <p className="text-sm text-neutral-600 m-0 mb-4">
                Close a tab in this module to open <span className="font-semibold text-neutral-800">“{capPrompt.title}”</span>.
            </p>
            <ul className="m-0 mb-5 p-0 list-none max-h-64 overflow-y-auto border border-neutral-200 rounded-lg divide-y divide-neutral-100">
                {moduleTabs.map((t) => (
                    <li key={t.id}>
                        <button type="button" onClick={() => closeAndOpen(t.id, t.status !== 'clean')} className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50 transition-colors" title={`Close “${t.title}” and open “${capPrompt.title}”`}>
                            {t.status !== 'clean' && <span className="w-1.5 h-1.5 rounded-full bg-warning-500 shrink-0" aria-label="unsaved changes" />}
                            <span className="truncate flex-1 text-neutral-800">{t.title}</span>
                            <X size={15} className="text-neutral-400 shrink-0" />
                        </button>
                    </li>
                ))}
            </ul>
            <div className="flex justify-end gap-2">
                <Button text="Cancel" variant="secondary" size="small" onClick={dismissCapPrompt} />
                {oldestClean && <Button text="Close oldest & open" variant="primary" size="small" onClick={() => closeAndOpen(oldestClean.id, oldestClean.status !== 'clean')} />}
            </div>
        </Modal>
    );
};

export default TabCapPrompt;
