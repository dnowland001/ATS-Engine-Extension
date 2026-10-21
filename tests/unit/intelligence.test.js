import { describe, it, expect } from 'vitest';
import { advertChecks, advertImprovements, matchSummary, bandLabel } from '../../packages/core/intelligence.js';

describe('advert health', () => {
  const report = {
    overall_score: 82,
    categories: {
      attraction: [{ id: 'salary', label: 'Salary stated', status: 'warn', suggestions: ['Give a range.'] }],
      clarity: [{ id: 'title', label: 'Title clarity', status: 'pass', suggestions: [] }],
      risk: [{ id: 'health', label: 'Health questions', status: 'not_applicable', suggestions: [] }, { id: 'age', label: 'Age-coded language', status: 'fail', suggestions: ['Remove "young".'] }],
    },
    improvements: [{ label: 'Age-coded language', suggestions: ['Remove "young".'] }, { label: 'Salary stated', suggestions: ['Give a range.'] }],
  };
  it('lists the checks that ran, leaving out not-applicable ones', () => {
    expect(advertChecks(report).map((c) => [c.label, c.status])).toEqual([['Salary stated', 'warn'], ['Title clarity', 'pass'], ['Age-coded language', 'fail']]);
  });
  it("keeps ATS Engine's order of improvements", () => {
    expect(advertImprovements(report).map((i) => i.label)).toEqual(['Age-coded language', 'Salary stated']);
  });
});

describe('match my database', () => {
  it('words the bands against the desk minimum', () => {
    expect(bandLabel('green', 70)).toBe('Meet your 70% minimum');
  });
  it('summarises counts and says when the limit cut in', () => {
    const s = matchSummary({ scoreable: true, threshold: 70, considered: 300, with_cv: 412, limited: true, counts: { green: 12, yellow: 31, red: 257 }, top: [] });
    expect(s.headline).toBe('300 candidates matched');
    expect(s.rows.map((r) => r.count)).toEqual([12, 31, 257]);
    expect(s.detail).toContain('412');
  });
  it('never ranks anyone when the vacancy could not be read', () => {
    expect(matchSummary({ scoreable: false }).headline).toBe('Nothing to match on yet');
  });
});
