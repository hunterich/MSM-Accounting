import React from 'react';
import { X, Plus, List } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';
import { moduleKeyOf, isDocumentModule, docModuleTitle, DOC_MODULES } from '../../stores/workspace/modules';
import { TAB_CAP } from '../../stores/workspace/types';

/**
 * Two-level tab bar (Accurate-style):
 *   row 1 — modules (Dashboard, Sales orders, Invoices, …) — switch areas.
 *   row 2 — the active document module's catalog + records + "New".
 * Page (non-migrated) modules have no second row — they're a single screen.
 */
const TwoLevelTabBar = (): React.ReactElement | null => {
    const tabs = useWorkspaceStore((s) => s.tabs);
    const activeTabId = useWorkspaceStore((s) => s.activeTabId);
    const activateTab = useWorkspaceStore((s) => s.activateTab);
    const activateModule = useWorkspaceStore((s) => s.activateModule);
    const closeTab = useWorkspaceStore((s) => s.closeTab);
    const closeModule = useWorkspaceStore((s) => s.closeModule);
    const { open } = useWorkspaceNav();

    if (tabs.length === 0) return null;

    const activeTab = tabs.find((t) => t.id === activeTabId);
    const activeModuleKey = activeTab ? moduleKeyOf(activeTab.target) : null;

    // Row 1: ordered unique modules; a module is dirty if any of its docs is.
    const modules: { key: string; title: string; dirty: boolean }[] = [];
    const byKey = new Map<string, { key: string; title: string; dirty: boolean }>();
    for (const t of tabs) {
        const key = moduleKeyOf(t.target);
        const dirty = t.status !== 'clean';
        const existing = byKey.get(key);
        if (existing) { if (dirty) existing.dirty = true; continue; }
        const m = { key, title: docModuleTitle(key) ?? t.title, dirty };
        byKey.set(key, m);
        modules.push(m);
    }

    const handleCloseModule = (key: string, dirty: boolean) => {
        if (dirty && !window.confirm('This module has unsaved changes. Close it and discard them?')) return;
        closeModule(key);
    };
    const handleCloseDoc = (id: string, dirty: boolean) => {
        if (dirty && !window.confirm('Discard unsaved changes in this tab?')) return;
        closeTab(id);
    };

    // Row 2: documents of the active document module.
    const docModule = activeModuleKey && isDocumentModule(activeModuleKey) ? DOC_MODULES[activeModuleKey] : null;
    const docTabs = activeModuleKey ? tabs.filter((t) => moduleKeyOf(t.target) === activeModuleKey) : [];
    const listTab = docTabs.find((t) => t.kind === 'list');
    const recordTabs = docTabs.filter((t) => t.kind !== 'list');

    const openCatalog = () => {
        if (listTab) activateTab(listTab.id);
        else if (docModule) open({ kind: 'list', target: { module: 'ar', entity: docModule.entity, recordId: 'catalog', mode: 'view' }, title: docModule.title, path: docModule.listPath });
    };
    const openNew = () => {
        if (docModule) open({ kind: 'doc-form', target: { module: 'ar', entity: docModule.entity, recordId: null, mode: 'create' }, title: docModule.newLabel, path: docModule.newPath, unique: true });
    };

    return (
        <div className="workbench-doc-tabs">
            <div className="workbench-doc-tab-row">
                {modules.map((m) => (
                    <button
                        key={m.key}
                        className={`workbench-doc-tab ${m.key === activeModuleKey ? 'active' : ''}`}
                        onClick={() => activateModule(m.key)}
                        title={m.title}
                    >
                        {m.dirty && <span className="w-1.5 h-1.5 rounded-full bg-warning-500 mr-1.5 inline-block" />}
                        {m.title}
                        <span className="workbench-doc-tab-close" onClick={(e) => { e.stopPropagation(); handleCloseModule(m.key, m.dirty); }}>
                            <X size={14} />
                        </span>
                    </button>
                ))}
                <div className="workbench-tab-count">{modules.length} module{modules.length === 1 ? '' : 's'}</div>
            </div>

            {docModule && (
                <div className="workbench-doc-tab-row secondary-row">
                    <button
                        className={`workbench-doc-tab workbench-doc-tab-catalog ${listTab && listTab.id === activeTabId ? 'active' : ''}`}
                        onClick={openCatalog}
                        title={`${docModule.title} list`}
                    >
                        <List size={16} />
                    </button>
                    <button className="workbench-doc-tab workbench-doc-tab-new" onClick={openNew} title={docModule.newLabel}>
                        <Plus size={16} />
                        {docModule.newLabel}
                    </button>
                    {recordTabs.map((t) => (
                        <button
                            key={t.id}
                            className={`workbench-doc-tab ${t.id === activeTabId ? 'active' : ''}`}
                            onClick={() => activateTab(t.id)}
                            title={t.title}
                        >
                            {t.status !== 'clean' && <span className="w-1.5 h-1.5 rounded-full bg-warning-500 mr-1.5 inline-block" />}
                            {t.title}
                            <span className="workbench-doc-tab-close" onClick={(e) => { e.stopPropagation(); handleCloseDoc(t.id, t.status !== 'clean'); }}>
                                <X size={14} />
                            </span>
                        </button>
                    ))}
                    <div className="workbench-tab-count">Open tabs: {tabs.length}/{TAB_CAP}</div>
                </div>
            )}
        </div>
    );
};

export default TwoLevelTabBar;
