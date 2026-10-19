import { describe, expect, it } from 'vitest';
import { accessScheduleStatus, isWithinAccessSchedule, scheduleValidationError } from '../access-schedule';

const office = { allowedDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], startTime: '08:00', endTime: '17:00' };
const at = (s: string) => new Date(s);
describe('organization-local access schedules', () => {
  it.each([
    ['2026-10-19T00:59:59Z', false], ['2026-10-19T01:00:00Z', true],
    ['2026-10-19T09:59:59Z', true], ['2026-10-19T10:00:00Z', false],
    ['2026-10-18T05:00:00Z', false],
  ])('Jakarta office hours at %s => %s', (date, expected) => {
    expect(isWithinAccessSchedule(office, 'Asia/Jakarta', at(date))).toBe(expected);
  });
  it('uses the selected company timezone, not UTC/server local time', () => {
    const now = at('2026-10-19T01:00:00Z');
    expect(isWithinAccessSchedule(office, 'Asia/Jakarta', now)).toBe(true);
    expect(isWithinAccessSchedule(office, 'Asia/Makassar', now)).toBe(true);
    expect(isWithinAccessSchedule(office, 'America/New_York', now)).toBe(false);
  });
  it.each([{}, { allowedDays: null, startTime: null, endTime: null }, { allowedDays: [] }])('empty schedule is unrestricted: %j', schedule => {
    expect(isWithinAccessSchedule(schedule, 'Asia/Jakarta', at('2026-10-18T20:00:00Z'))).toBe(true);
  });
  it('supports day-only and time-only restrictions', () => {
    expect(isWithinAccessSchedule({ allowedDays: ['Mon'] }, 'UTC', at('2026-10-19T23:59:59Z'))).toBe(true);
    expect(isWithinAccessSchedule({ allowedDays: ['Mon'] }, 'UTC', at('2026-10-20T00:00:00Z'))).toBe(false);
    expect(isWithinAccessSchedule({ startTime: '08:00', endTime: '17:00' }, 'UTC', at('2026-10-18T12:00:00Z'))).toBe(true);
  });
  it.each([
    ['2026-10-19T21:59:59Z', false], ['2026-10-19T22:00:00Z', true],
    ['2026-10-20T05:59:59Z', true], ['2026-10-20T06:00:00Z', false],
    ['2026-10-19T02:00:00Z', false],
  ])('overnight shift belongs to its start day: %s', (date, expected) => {
    expect(isWithinAccessSchedule({ allowedDays: ['Mon'], startTime: '22:00', endTime: '06:00' }, 'UTC', at(date))).toBe(expected);
  });
  it('wraps overnight Sunday into Monday', () => {
    expect(isWithinAccessSchedule({ allowedDays: ['Sun'], startTime: '22:00', endTime: '06:00' }, 'UTC', at('2026-10-19T02:00:00Z'))).toBe(true);
  });
  it('handles both occurrences of a repeated DST hour in company-local time', () => {
    const schedule = { allowedDays: ['Sun'], startTime: '01:00', endTime: '02:00' };
    expect(isWithinAccessSchedule(schedule, 'America/New_York', at('2026-11-01T05:30:00Z'))).toBe(true);
    expect(isWithinAccessSchedule(schedule, 'America/New_York', at('2026-11-01T06:30:00Z'))).toBe(true);
    expect(isWithinAccessSchedule(schedule, 'America/New_York', at('2026-11-01T07:00:00Z'))).toBe(false);
  });
  it.each([
    { allowedDays: ['Monday'] }, { allowedDays: 'Mon' }, { startTime: '08:00' },
    { startTime: '24:00', endTime: '17:00' }, { startTime: '08:60', endTime: '17:00' },
    { startTime: '8:00', endTime: '17:00' }, { startTime: '08:00', endTime: '08:00' },
  ])('rejects invalid policy and denies stored invalid policy: %j', schedule => {
    expect(scheduleValidationError(schedule)).toBeTruthy();
    expect(isWithinAccessSchedule(schedule, 'UTC', at('2026-10-19T12:00:00Z'))).toBe(false);
  });
  it('denies a restricted schedule with an invalid timezone', () => {
    expect(isWithinAccessSchedule(office, 'invalid-zone')).toBe(false);
  });
  it('exempts only ADMIN, not ordinary staff or accountants', () => {
    for (const roleType of ['ADMIN', 'ACCOUNTANT', 'CUSTOM', 'VIEWER']) {
      expect(accessScheduleStatus({ ...office, roleType }, 'Asia/Jakarta', at('2026-10-19T12:00:00Z')).allowed).toBe(roleType === 'ADMIN');
    }
  });
});
