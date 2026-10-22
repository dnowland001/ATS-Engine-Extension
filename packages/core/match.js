/*
 * Reading ATS Engine's own match result for the job seeker popup
 * (21 Oct 2026).
 *
 * Nothing here scores anything. The score, the band, the minimum, the
 * evidence for each requirement and whether tailoring can reach the
 * minimum all come from ATS Engine's candidate_fit - the same result the
 * Job Analysis card shows. This only turns those fields into words, and
 * every sentence is tied to a field: no field, no sentence.
 */

/** ATS Engine's evidence bands, worded as the Job Analysis card words them. */
export const EVIDENCE = {
  evidenced: { label: 'Evidenced', symbol: '✓', tone: 'ok', note: 'named in your CV with a result beside it' },
  practised: { label: 'Practised', symbol: '✓', tone: 'ok', note: 'it recurs across your CV or your recorded experience' },
  named: { label: 'Named only', symbol: '⚠', tone: 'warn', note: 'one passing mention - adding a result beside it is the quickest way to move this score' },
  absent: { label: 'Not evidenced', symbol: '✕', tone: 'bad', note: 'nothing in your CVs shows it yet' },
};
const ORDER = ['evidenced', 'practised', 'named', 'absent'];

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The job's must-haves with the evidence ATS Engine found for each, strongest first. */
export function requirements(fit) {
  const rows = (fit?.requirement_evidence || [])
    .filter((r) => r && r.skill)
    .map((r) => ({ skill: cap(String(r.skill)), band: EVIDENCE[r.band] ? r.band : 'absent' }));
  if (rows.length) {
    return rows.sort((a, b) => ORDER.indexOf(a.band) - ORDER.indexOf(b.band));
  }
  // Older result with no evidence bands: the plain matched / missing lists.
  return [
    ...(fit?.matched_skills || []).map((s) => ({ skill: cap(s), band: 'practised' })),
    ...(fit?.missing_skills || []).map((s) => ({ skill: cap(s), band: 'absent' })),
  ];
}

/**
 * The headline and the next step.
 *
 * @param fit          job.candidate_fit from ATS Engine (may be null)
 * @param cvCount      how many CVs the candidate has (from /extension/me)
 * @param application  job.application from ATS Engine (may be null)
 */
export function summarise(fit, { cvCount = null, application = null } = {}) {
  const reqs = requirements(fit);
  const gaps = reqs.filter((r) => r.band === 'absent' || r.band === 'named');
  const met = reqs.filter((r) => r.band === 'evidenced' || r.band === 'practised');
  const applied = Boolean(application && !['waiting', 'longshot', 'draft'].includes(application.status));
  const min = fit?.minimum_score_threshold;

  const out = {
    score: null,
    tone: 'warn',
    headline: '',
    detail: '',
    next: { kind: 'review', text: '' },
    requirements: reqs,
    met: met.length,
    gaps: gaps.length,
    strengthen: gaps.slice(0, 3).map((g) => g.skill),
    cv: fit?.best_cv ? fit.best_cv.filename + (fit.best_cv.of > 1 ? ` (the best fit of your ${fit.best_cv.of} CVs)` : '') : null,
    applied,
  };

  if (cvCount === 0) {
    out.headline = 'Add your CV first';
    out.detail = 'ATS Engine checks a job against your CV. Upload it once in your CV Library and every job you check is matched against it.';
    out.next = { kind: 'upload', text: 'Upload your CV' };
    return out;
  }

  if (!fit) {
    out.headline = 'No match yet';
    out.detail = 'ATS Engine saved the job but could not match it to your CV. Open it in ATS Engine to see why.';
    out.next = { kind: 'review', text: 'Open it in ATS Engine' };
    return out;
  }

  if (fit.scoreable === false) {
    out.headline = 'No score for this one yet';
    out.detail = "ATS Engine couldn't read this job's requirements, so it hasn't given a score rather than show a misleading zero. Check the description in ATS Engine - adding the requirements gives you a real match.";
    out.next = { kind: 'review', text: 'Review the job in ATS Engine' };
    return out;
  }

  out.score = Math.round(Number(fit.score));
  if (fit.meets_minimum) {
    out.tone = 'ok';
    out.headline = 'Worth applying';
    out.detail = `Your CV meets your ${min}% minimum for this job.`;
    out.next = gaps.length
      ? { kind: 'apply', text: `Before you apply, consider strengthening: ${out.strengthen.join(', ')}.` }
      : { kind: 'apply', text: 'Your CV covers what this job asks for.' };
  } else if (fit.tailoring_can_meet_minimum) {
    out.tone = 'warn';
    out.headline = 'Tailor your CV first';
    out.detail = `Below your ${min}% minimum as it stands, but your CVs between them already show evidence that would take it to ${Math.round(Number(fit.potential_score))}%. A tailored CV pulls that together.`;
    out.next = { kind: 'tailor', text: 'Tailor your CV for this job' };
  } else {
    out.tone = 'bad';
    out.headline = 'Review before applying';
    out.detail = `Below your ${min}% minimum. ${gaps.length ? `${gaps.length} of the job's requirements are not clearly evidenced in your CV.` : ''}`.trim();
    out.next = { kind: 'review', text: 'Look at the requirements in ATS Engine before you decide' };
  }

  if (applied) {
    out.next = { kind: 'applied', text: application.applied_on ? `You applied on ${application.applied_on}.` : 'You have applied for this job.' };
  }
  return out;
}

/*
 * Job Insight (E3, 22 Oct 2026) - Job Seeker Pro and its trial - put into
 * words. As above: every line comes from a field ATS Engine sent.
 */
const CRITERION = (c) => String(c || '').replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

export function insightSummary(res) {
  if (!res) return null;
  const line = (c) => ({ label: CRITERION(c.criterion), detail: `${c.earned} of ${c.possible}`, percent: c.percent });
  return {
    verdict: res.verdict || '',
    strongest: (res.strongest || []).map(line),
    weakest: (res.weakest || []).map(line),
    gaps: (res.gaps || []).map((g) => ({ ...g, skill: cap(g.skill), ev: EVIDENCE[g.band] || EVIDENCE.absent })),
    transferable: (res.transferable || []).map((t) => cap(t.skill)),
    history: res.history?.summary || '',
    step: res.next_step || null,
    noCv: Boolean(res.no_cv),
    unreadable: res.scoreable === false && !res.no_cv,
  };
}

/* What Job Seeker Pro adds on every job - the offer shown to Job Seeker. */
export const INSIGHT_PITCH = [
  'Why this job fits you - or why it does not - criterion by criterion',
  'The gaps to fix first, and exactly how to fix each one',
  'Skills you already have that this CV does not show',
  'How your applications to roles like this have gone',
  'The one thing to do next: apply, tailor, or move on',
];
