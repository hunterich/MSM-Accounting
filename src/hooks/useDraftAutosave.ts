// src/hooks/useDraftAutosave.ts
import { useEffect, useMemo, useRef } from 'react';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { debounce } from '../utils/debounce';
import { DRAFT_FLUSH_EVENT } from '../stores/useAccessScheduleStore';

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

    useEffect(() => {
        const preserve = () => { if (tabId) saveDraft(tabId, latest.current); writer.flush(); };
        window.addEventListener(DRAFT_FLUSH_EVENT, preserve);
        window.addEventListener('pagehide', preserve);
        return () => {
            window.removeEventListener(DRAFT_FLUSH_EVENT, preserve);
            window.removeEventListener('pagehide', preserve);
        };
    }, [tabId, saveDraft, writer]);
}
