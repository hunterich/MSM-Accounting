import React, { useState } from 'react';
import { X, Plus, List, XCircle, ChevronRight, RotateCcw, Copy } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';
import { moduleKeyOf, isDocumentModule, docModuleTitle, DOC_MODULES } from '../../stores/workspace/modules';
import { TAB_CAP } from '../../stores/workspace/types';
import TabContextMenu, { type TabMenuItem } from './TabContextMenu';

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
    const closeOthers = useWorkspaceStore((s) => s.closeOthers);
    const closeToRight = useWorkspaceStore((s) => s.closeToRight);
    const closeAll = useWorkspaceStore((s) => s.closeAll);
    const reopenClosed = useWorkspaceStore((s) => s.reopenClosed);
    const closedStack = useWorkspaceStore((s) => s.closedStack);
    const { open } = useWorkspaceNav();

    const [menu, setMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

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

    // Build the right-click menu for a record tab. Bulk closes confirm once if
    // any affected tab carries unsaved changes.
    const buildMenu = (id: string): TabMenuItem[] => {
        const idx = tabs.findIndex((t) => t.id === id);
        const self = tabs[idx];
        const othersDirty = tabs.some((t) => t.id !== id && t.status !== 'clean');
        const rightDirty = tabs.slice(idx + 1).some((t) => t.status !== 'clean');
        const anyDirty = tabs.some((t) => t.status !== 'clean');
        const hasOthers = tabs.length > 1;
        const hasRight = idx < tabs.length - 1;
        const confirmBulk = (dirty: boolean, msg: string) => !dirty || window.confirm(msg);
        return [
            { label: 'Close', icon: <X size={15} />, onClick: () => handleCloseDoc(id, self?.status !== 'clean') },
            { label: 'Close others', icon: <Copy size={15} />, disabled: !hasOthers, onClick: () => { if (confirmBulk(othersDirty, 'Some other tabs have unsaved changes. Close them and discard?')) closeOthers(id); } },
            { label: 'Close to the right', icon: <ChevronRight size={15} />, disabled: !hasRight, onClick: () => { if (confirmBulk(rightDirty, 'Tabs to the right have unsaved changes. Close them and discard?')) closeToRight(id); } },
            { label: 'Close all', icon: <XCircle size={15} />, onClick: () => { if (confirmBulk(anyDirty, 'Some tabs have unsaved changes. Close all and discard?')) closeAll(); } },
            { label: 'Reopen closed tab', icon: <RotateCcw size={15} />, disabled: closedStack.length === 0, onClick: () => reopenClosed() },
        ];
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
                    <div className="workbench-doc-tab-scroll">
                        {recordTabs.map((t) => (
                            <button
                                key={t.id}
                                className={`workbench-doc-tab ${t.id === activeTabId ? 'active' : ''}`}
                                onClick={() => activateTab(t.id)}
                                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); handleCloseDoc(t.id, t.status !== 'clean'); } }}
                                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, tabId: t.id }); }}
                                title={t.title}
                            >
                                {t.status !== 'clean' && <span className="w-1.5 h-1.5 rounded-full bg-warning-500 mr-1.5 inline-block" />}
                                {t.title}
                                <span className="workbench-doc-tab-close" onClick={(e) => { e.stopPropagation(); handleCloseDoc(t.id, t.status !== 'clean'); }}>
                                    <X size={14} />
                                </span>
                            </button>
                        ))}
                    </div>
                    <div className="workbench-tab-count">Open tabs: {tabs.length}/{TAB_CAP}</div>
                </div>
            )}

            {menu && (
                <TabContextMenu x={menu.x} y={menu.y} items={buildMenu(menu.tabId)} onClose={() => setMenu(null)} />
            )}
        </div>
    );
};

export default TwoLevelTabBar;
