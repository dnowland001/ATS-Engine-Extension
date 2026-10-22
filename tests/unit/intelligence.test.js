import { describe, it, expect } from 'vitest';
import { advertChecks, advertImprovements, matchSummary, bandLabel, professionalSummary, candidateSummary } from '../../packages/core/intelligence.js';

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

describe('professional insight (E1)', () => {
  const res = {
    scoreable: true, threshold: 70,
    coverage: { suitable: 1, minimum: 3, meets: false, gap: { why: 'A shortlist needs at least 3 people who fit.' } },
    missing_must_haves: { skills: ['forklift operation'], gap: { why: 'Has to be sourced.' } },
    gaps: [{ id: 4, severity: 'critical', title: 'DBS expired', why: 'May not be placed.', destination: '/recruiter/candidates/5' }],
    opportunities: { total: 2, threshold: 70, items: [{ candidate_id: 5, name: 'Sam', score: 86, town: 'Leeds', destination: '/recruiter/candidates/5' }] },
    next_actions: [{ title: 'Sam for Care', reason: 'r', priority: { score: 66, band: 'today', parts: [{ label: 'Strong match', points: 50 }, { label: '86 against 70', points: 16 }] }, action: { label: 'Open candidate' }, destination: '/recruiter/candidates/5' }],
  };
  it("words coverage against the desk's own minimum", () => {
    const s = professionalSummary(res);
    expect(s.coverage.headline).toBe('Only 1 suitable - your desk aims for 3');
    expect(s.coverage.tone).toBe('warn');
    expect(professionalSummary({ coverage: { suitable: 0, minimum: 3, meets: false } }).coverage.tone).toBe('bad');
    expect(professionalSummary({ coverage: { suitable: 4, minimum: 3, meets: true } }).coverage.headline).toBe('4 suitable candidates - enough for a shortlist');
  });
  it("keeps ATS Engine's points and shows how they add up", () => {
    const [step] = professionalSummary(res).steps;
    expect([step.bandLabel, step.points]).toEqual(['Today', 66]);
    expect(step.parts).toEqual(['Strong match +50', '86 against 70 +16']);
  });
  it('leaves out what the account does not have', () => {
    const s = professionalSummary({ scoreable: true, gaps: [] });
    expect([s.coverage, s.matches, s.missing, s.steps]).toEqual([null, null, [], []]);
  });
  it('says when the vacancy could not be read', () => {
    expect(professionalSummary({ scoreable: false }).unread).toContain("couldn't read");
  });
});

describe('candidate context (E2)', () => {
  it("leaves the known person's own row out of 'could be the same person'", () => {
    const s = candidateSummary({ known: { id: 5, name: 'Sam', applications: [{ status: 'interviewing' }], gaps: [] }, possible_matches: [{ id: 5, reason: 'same_phone' }, { id: 9, reason: 'similar_name' }] });
    expect(s.known.headline).toBe('Sam is already in your Talent Pool');
    expect(s.known.apps[0].statusLabel).toBe('Interviewing');
    expect(s.maybe.map((m) => m.id)).toEqual([9]);
  });
  it('says when it scored from the page and when there was nothing to score', () => {
    expect(candidateSummary({ scored_from: 'page', best_fit: [] }).fromPage).toBe(true);
    expect(candidateSummary({ scoreable: false }).unreadable).toBe(true);
  });
});
