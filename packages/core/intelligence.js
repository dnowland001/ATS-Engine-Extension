/*
 * Recruiter extension Phase 2 (21 Oct 2026): ATS Engine's own Advert
 * Health, Job Analysis and Match my database results, put into words for
 * the popup. Nothing is scored here - every number and label comes from
 * the API response, and an absent field produces no sentence.
 */

/** Advert Health check statuses, as the Tools page words them. */
export const CHECK_STATUS = {
  pass: { symbol: '✓', tone: 'ok', label: 'Good' },
  warn: { symbol: '⚠', tone: 'warn', label: 'Review' },
  fail: { symbol: '✕', tone: 'bad', label: 'Fix' },
};

/** The ten checks, flattened in the order ATS Engine returned them; not-applicable ones left out. */
export function advertChecks(report) {
  const rows = [];
  for (const list of Object.values(report?.categories || {})) {
    for (const c of list || []) {
      if (!CHECK_STATUS[c.status]) continue;
      rows.push({ id: c.id, label: c.label, status: c.status, suggestion: (c.suggestions || [])[0] || null });
    }
  }
  return rows;
}

/** Top suggestions, most score to gain first (ATS Engine's own ordering). */
export function advertImprovements(report, n = 3) {
  return (report?.improvements || []).slice(0, n).map((i) => ({ label: i.label, suggestion: (i.suggestions || [])[0] || '' }));
}

/** ScoreBand bands, worded against the desk's own minimum. */
export function bandLabel(band, threshold) {
  return {
    green: `Meet your ${threshold}% minimum`,
    yellow: 'Close to your minimum',
    red: 'Below your minimum',
  }[band];
}

export function matchSummary(res) {
  if (!res) return null;
  if (res.scoreable === false) {
    return {
      headline: 'Nothing to match on yet',
      detail: "ATS Engine couldn't read this vacancy's requirements, so it hasn't ranked anyone rather than rank everyone at 0%. Add the essential requirements to the vacancy and match again.",
      rows: [],
      top: [],
    };
  }
  const t = res.threshold;
  const rows = ['green', 'yellow', 'red'].map((b) => ({ band: b, count: res.counts?.[b] || 0, label: bandLabel(b, t) }));
  const n = res.considered || 0;
  return {
    headline: n === 0 ? 'No candidates with a CV to match' : `${n} candidate${n === 1 ? '' : 's'} matched`,
    detail: res.limited ? `The ${n} most recently updated of your ${res.with_cv} candidates with a CV. Open the vacancy in ATS Engine to see everyone.` : '',
    rows,
    top: res.top || [],
  };
}

/*
 * ATS Engine Professional in the recruiter extension (E1, 22 Oct 2026):
 * a vacancy's intelligence put into words. As with everything above,
 * nothing is worked out here - the counts, gaps, matches and points are
 * ATS Engine's, and a section the account does not have is simply absent.
 */
export const SEVERITY_TONE = { critical: 'bad', high: 'warn', medium: 'warn', low: 'muted' };
export const BAND_LABEL = { now: 'Now', today: 'Today', this_week: 'This week' };

export function professionalSummary(res) {
  if (!res) return null;
  const cov = res.coverage;
  const coverage = cov
    ? {
        tone: cov.meets ? 'ok' : cov.suitable === 0 ? 'bad' : 'warn',
        headline: cov.meets
          ? `${cov.suitable} suitable candidate${cov.suitable === 1 ? '' : 's'} - enough for a shortlist`
          : cov.suitable === 0
            ? 'Nobody suitable in your pool yet'
            : `Only ${cov.suitable} suitable - your desk aims for ${cov.minimum}`,
        detail: cov.gap?.why || '',
      }
    : null;
  const unread = res.scoreable === false
    ? "ATS Engine couldn't read this vacancy's requirements yet, so coverage and matches wait until the essentials are on the vacancy."
    : '';
  return {
    unread,
    coverage,
    missing: res.missing_must_haves?.skills || [],
    missingWhy: res.missing_must_haves?.gap?.why || '',
    steps: (res.next_actions || []).map((a) => ({
      title: a.title,
      reason: a.reason || '',
      band: a.priority?.band || 'this_week',
      bandLabel: BAND_LABEL[a.priority?.band] || 'This week',
      points: a.priority?.score ?? 0,
      parts: (a.priority?.parts || []).map((p) => `${p.label} +${p.points}`),
      action: a.action?.label || 'Open',
      destination: a.destination || null,
    })),
    matches: res.opportunities
      ? { total: res.opportunities.total, threshold: res.opportunities.threshold, items: res.opportunities.items || [] }
      : null,
    gaps: (res.gaps || []).map((g) => ({ ...g, tone: SEVERITY_TONE[g.severity] || 'muted' })),
  };
}
