import { describe, it, expect } from 'vitest';
import { dayLabel, daysFrom, relative, seenBefore, journey, followUpDays, closingBadge } from '../../packages/core/apply.js';

const TODAY = new Date(2026, 9, 23); // Fri 23 Oct 2026

describe('dates', () => {
  it('labels a day, with the year only when it is another year', () => {
    expect(dayLabel('2026-10-30', TODAY)).toBe('Fri 30 Oct');
    expect(dayLabel('2027-01-12', TODAY)).toBe('Tue 12 Jan 2027');
    expect(dayLabel('', TODAY)).toBe('');
  });
  it('counts days from today and words them', () => {
    expect(daysFrom('2026-10-23', TODAY)).toBe(0);
    expect(relative('2026-10-24', TODAY)).toBe('tomorrow');
    expect(relative('2026-10-30', TODAY)).toBe('in 7 days');
    expect(relative('2026-10-20', TODAY)).toBe('3 days ago');
  });
  it('knows a job seen on an earlier day', () => {
    expect(seenBefore({ checked_on: '2026-10-20' }, TODAY)).toBe(true);
    expect(seenBefore({ checked_on: '2026-10-23' }, TODAY)).toBe(false);
    expect(seenBefore({}, TODAY)).toBe(false);
  });
});

describe('the journey', () => {
  it('before applying: checked, apply now, follow up later', () => {
    const j = journey({ status: 'waiting', checked_on: '2026-10-20', applied_on: null }, TODAY);
    expect(j.map((s) => s.state)).toEqual(['done', 'current', 'later']);
    expect(j[1].when).toBe('Not yet');
  });
  it('applied: the follow-up day, current once it is due', () => {
    const a = { status: 'applied', checked_on: '2026-10-14', applied_on: '2026-10-16', follow_up_on: '2026-10-23' };
    expect(journey(a, TODAY).map((s) => s.state)).toEqual(['done', 'done', 'current']);
    expect(journey(a, TODAY)[2].when).toBe('Fri 23 Oct');
    expect(journey({ ...a, follow_up_on: '2026-10-30' }, TODAY)[2].state).toBe('later');
    expect(followUpDays(a)).toBe(7);
  });
  it('an interview replaces the follow-up', () => {
    const j = journey({ status: 'interviewing', checked_on: '2026-10-01', applied_on: '2026-10-02' }, TODAY);
    expect(j[2]).toMatchObject({ label: 'Interview', state: 'done' });
  });
});

describe('the closing badge', () => {
  it('soon, today, passed and plenty of time', () => {
    expect(closingBadge({ date: '2026-10-25' }, TODAY)).toMatchObject({ tone: 'warn', text: 'Closes in 2 days', day: 25, month: 'OCT' });
    expect(closingBadge({ date: '2026-10-23' }, TODAY)).toMatchObject({ tone: 'bad', text: 'Closes today' });
    expect(closingBadge({ date: '2026-10-20' }, TODAY)).toMatchObject({ tone: 'bad', text: 'This advert has closed' });
    expect(closingBadge({ date: '2026-11-20' }, TODAY)).toMatchObject({ tone: 'ok', text: 'Closes Fri 20 Nov', sub: '28 days to apply.' });
    expect(closingBadge(null, TODAY)).toBeNull();
  });
});
