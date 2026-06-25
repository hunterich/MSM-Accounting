// src/components/workspace/tabRegistry.tsx
import React from 'react';
import type { WorkspaceTab } from '../../stores/workspace/types';

/** Renders the body for a tab. Extended per-entity as modules are wired in. */
export function renderTab(tab: WorkspaceTab): React.ReactNode {
    // Milestone 2+ adds entity branches above this fallback.
    return (
        <div className="p-6 text-sm text-neutral-500">
            <div className="font-medium text-neutral-700">{tab.title}</div>
            <div>No renderer registered for "{tab.target.module}/{tab.target.entity}" yet.</div>
        </div>
    );
}
