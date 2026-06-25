// src/components/workspace/tabRegistry.tsx
import React from 'react';
import type { WorkspaceTab } from '../../stores/workspace/types';
import SOFormV2 from '../ar/salesorders/SOFormV2';
import SalesOrderListPane from '../ar/salesorders/SalesOrderListPane';
import SODetailPane from '../ar/salesorders/SODetailPane';

/** Renders the body for a tab. Extended per-entity as modules are wired in. */
export function renderTab(tab: WorkspaceTab): React.ReactNode {
    const { module, entity, mode, recordId } = tab.target;

    if (module === 'ar' && entity === 'sales-order') {
        if (tab.kind === 'list') return <SalesOrderListPane />;
        if (tab.kind === 'doc-form') {
            return <SOFormV2 mode={mode === 'edit' ? 'edit' : 'create'} workspaceTabId={tab.id} recordId={recordId ?? undefined} />;
        }
        if (tab.kind === 'doc-view') return <SODetailPane soId={recordId ?? ''} workspaceTabId={tab.id} />;
    }

    return (
        <div className="p-6 text-sm text-neutral-500">
            <div className="font-medium text-neutral-700">{tab.title}</div>
            <div>No renderer registered for "{module}/{entity}" yet.</div>
        </div>
    );
}
