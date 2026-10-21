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
