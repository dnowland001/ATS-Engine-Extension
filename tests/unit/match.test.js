import { describe, it, expect } from 'vitest';
import { summarise, requirements } from '../../packages/core/match.js';

const fit = (over = {}) => ({
  score: 78, scoreable: true, band: 'green', meets_minimum: true, minimum_score_threshold: 70,
  requirement_evidence: [
    { skill: 'scrum', band: 'named' },
    { skill: 'agile delivery', band: 'evidenced' },
    { skill: 'financial services', band: 'absent' },
    { skill: 'stakeholder management', band: 'practised' },
  ],
  best_cv: { id: 1, filename: 'Dennis CV.pdf', of: 3 },
  tailoring_can_meet_minimum: true, potential_score: 82,
  ...over,
});

describe('requirements', () => {
  it('uses ATS Engine evidence bands, strongest first', () => {
    expect(requirements(fit()).map((r) => [r.skill, r.band])).toEqual([
      ['Agile delivery', 'evidenced'], ['Stakeholder management', 'practised'], ['Scrum', 'named'], ['Financial services', 'absent'],
    ]);
  });
  it('falls back to matched / missing when there are no bands', () => {
    expect(requirements({ matched_skills: ['sql'], missing_skills: ['aws'] })).toEqual([
      { skill: 'Sql', band: 'practised' }, { skill: 'Aws', band: 'absent' },
    ]);
  });
});

describe('summarise', () => {
  it('meets the minimum: worth applying, with what to strengthen', () => {
    const s = summarise(fit(), { cvCount: 3 });
    expect(s.score).toBe(78);
    expect(s.headline).toBe('Worth applying');
    expect(s.met).toBe(2);
    expect(s.gaps).toBe(2);
    expect(s.next.text).toBe('Before you apply, consider strengthening: Scrum, Financial services.');
    expect(s.cv).toBe('Dennis CV.pdf (the best fit of your 3 CVs)');
  });

  it('below the minimum but tailoring can reach it: tailor first, with ATS Engine\'s own figure', () => {
    const s = summarise(fit({ score: 61, meets_minimum: false, band: 'yellow' }), { cvCount: 3 });
    expect(s.headline).toBe('Tailor your CV first');
    expect(s.detail).toContain('82%');
    expect(s.next.kind).toBe('tailor');
  });

  it('below and tailoring cannot reach it: review, never "apply"', () => {
    const s = summarise(fit({ score: 30, meets_minimum: false, tailoring_can_meet_minimum: false }), { cvCount: 1 });
    expect(s.headline).toBe('Review before applying');
    expect(s.next.kind).toBe('review');
  });

  it('nothing readable: no score at all rather than 0%', () => {
    const s = summarise(fit({ score: 0, scoreable: false }), { cvCount: 1 });
    expect(s.score).toBeNull();
    expect(s.headline).toBe('No score for this one yet');
  });

  it('no CV: upload first', () => {
    expect(summarise(null, { cvCount: 0 }).next.kind).toBe('upload');
  });

  it('already applied says so', () => {
    const s = summarise(fit(), { cvCount: 1, application: { status: 'applied', applied_on: '2026-10-21' } });
    expect(s.applied).toBe(true);
    expect(s.next.text).toBe('You applied on 2026-10-21.');
  });

  it('waiting / long shot is not applied', () => {
    expect(summarise(fit(), { application: { status: 'waiting' } }).applied).toBe(false);
  });
});
