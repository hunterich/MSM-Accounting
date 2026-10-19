/** Shared, framework-free schedule policy. All times are organization-local. */
export const SCHEDULE_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export interface AccessSchedule {
  allowedDays?: unknown;
  startTime?: string | null;
  endTime?: string | null;
}

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function scheduleValidationError(schedule: AccessSchedule): string | null {
  const days = schedule.allowedDays;
  if (days != null && (!Array.isArray(days) || days.some(d => !SCHEDULE_DAYS.includes(d)))) {
    return 'Allowed days must contain only Mon, Tue, Wed, Thu, Fri, Sat or Sun.';
  }
  const start = schedule.startTime || null;
  const end = schedule.endTime || null;
  if (!!start !== !!end) return 'Provide both start and end times, or leave both blank for all day.';
  if (start && end) {
    if (!timePattern.test(start) || !timePattern.test(end)) return 'Access times must use HH:mm (00:00–23:59).';
    if (start === end) return 'Start and end times must differ. Leave both blank for all day.';
  }
  return null;
}

/** Empty days means every day; empty times means all day. Invalid stored policy denies. */
export function isWithinAccessSchedule(schedule: AccessSchedule, timezone: string, now = new Date()): boolean {
  if (scheduleValidationError(schedule)) return false;
  const days = schedule.allowedDays as string[] | null | undefined;
  if ((!days || days.length === 0) && !schedule.startTime && !schedule.endTime) return true;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    const part = (type: string) => parts.find(p => p.type === type)!.value;
    const day = part('weekday');
    const time = `${part('hour')}:${part('minute')}`;
    const dayAllowed = (d: string) => !days?.length || days.includes(d);
    const start = schedule.startTime;
    const end = schedule.endTime;
    if (!start || !end) return dayAllowed(day);
    if (start < end) return dayAllowed(day) && time >= start && time < end;
    // An overnight shift is assigned to its START day, including across Sunday/Monday.
    const previousDay = SCHEDULE_DAYS[(SCHEDULE_DAYS.indexOf(day as typeof SCHEDULE_DAYS[number]) + 6) % 7];
    return (time >= start && dayAllowed(day)) || (time < end && dayAllowed(previousDay));
  } catch {
    return false; // Invalid timezone or clock must never silently widen access.
  }
}

export interface AccessScheduleStatus {
  allowed: boolean;
  exempt: boolean;
  timezone: string;
  schedule: AccessSchedule;
  serverNow: string;
}

export function accessScheduleStatus(role: AccessSchedule & { roleType: string }, timezone: string, now = new Date()): AccessScheduleStatus {
  const exempt = role.roleType === 'ADMIN';
  const schedule = { allowedDays: role.allowedDays ?? null, startTime: role.startTime ?? null, endTime: role.endTime ?? null };
  return { allowed: exempt || isWithinAccessSchedule(schedule, timezone, now), exempt, timezone, schedule, serverNow: now.toISOString() };
}
