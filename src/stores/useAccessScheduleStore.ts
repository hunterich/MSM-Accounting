import { create } from 'zustand';
import type { AccessScheduleStatus } from '../../lib/access-schedule';

export const DRAFT_FLUSH_EVENT = 'msm:preserve-unfinished-work';
export const SCHEDULE_DENIED_EVENT = 'msm:access-schedule-denied';

/** Not persisted: neither a cached role nor the browser clock authorizes access. */
export const useAccessScheduleStore = create<{
  status: AccessScheduleStatus | null;
  context: string;
  receivedAt: number;
  denied: boolean;
  pendingWrites: number;
  update: (status: AccessScheduleStatus, context: string) => void;
  deny: () => void;
  pending: (delta: number) => void;
}>((set) => ({
  status: null, context: '', receivedAt: 0, denied: false, pendingWrites: 0,
  update: (status, context) => set({ status, context, receivedAt: performance.now(), denied: !status.allowed }),
  deny: () => {
    set({ denied: true });
    window.dispatchEvent(new Event(SCHEDULE_DENIED_EVENT));
  },
  pending: (delta) => set(s => ({ pendingWrites: Math.max(0, s.pendingWrites + delta) })),
}));
