// src/hooks/useDraftAutosave.ts
import { useEffect, useMemo, useRef } from 'react';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { debounce } from '../utils/debounce';

/** Persists `snapshot` into the workspace tab `tabId` as a recoverable draft. */
export function useDraftAutosave(tabId: string | undefined, snapshot: unknown, delay = 600): void {
    const saveDraft = useWorkspaceStore((s) => s.saveDraft);
    const latest = useRef(snapshot);
    latest.current = snapshot;

    const writer = useMemo(
        () => debounce((id: string) => saveDraft(id, latest.current), delay),
        [saveDraft, delay],
    );

    useEffect(() => {
        if (!tabId) return;
        writer(tabId);
    }, [tabId, snapshot, writer]);

    useEffect(() => () => writer.flush(), [writer]);
}
