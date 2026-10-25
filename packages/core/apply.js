/*
 * Applying, made easy (Seekers 0.4.0, 23 Oct 2026): the words and dates
 * the popup shows for the journey of one application - when it was
 * checked, when it was sent, when to follow up - and for the advert
 * check. Pure functions, so they are tested on their own. Every date
 * comes from ATS Engine as YYYY-MM-DD and is read as a local date.
 */
const DAY = 86400000;

export function parseDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** "Thu 30 Oct" - with the year only when it is not this year. */
export function dayLabel(iso, today = new Date()) {
  const d = parseDay(iso);
  if (!d) return '';
  const opts = { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) };
  return d.toLocaleDateString('en-GB', opts).replace(',', '');
}

/** Whole days from today to the date: 0 today, 1 tomorrow, -2 two days ago. */
export function daysFrom(iso, today = new Date()) {
  const d = parseDay(iso);
  return d ? Math.round((d - startOf(today)) / DAY) : null;
}

export function relative(iso, today = new Date()) {
  const n = daysFrom(iso, today);
  if (n === null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 1 ? `in ${n} days` : `${-n} days ago`;
}

/** Seen this job on an earlier day? */
export const seenBefore = (application, today = new Date()) => {
  const n = daysFrom(application?.checked_on, today);
  return n !== null && n < 0;
};

/*
 * The application's journey, three steps: Checked -> Applied -> Follow up.
 * Each step is done (it happened), current (what to do now) or later.
 */
export function journey(a, today = new Date()) {
  const applied = Boolean(a?.applied_on);
  const followDue = applied && a.follow_up_on && daysFrom(a.follow_up_on, today) <= 0;
  const closedOut = ['rejected', 'withdrawn', 'accepted'].includes(a?.status);
  const beyond = ['interviewing', 'offer', 'accepted'].includes(a?.status);
  return [
    { key: 'checked', label: 'Checked', when: a?.checked_on ? dayLabel(a.checked_on, today) : '', state: 'done' },
    { key: 'applied', label: 'Applied', when: applied ? dayLabel(a.applied_on, today) : closedOut ? '' : 'Not yet', state: applied ? 'done' : closedOut ? 'later' : 'current' },
    beyond
      ? { key: 'follow', label: a.status === 'interviewing' ? 'Interview' : a.status === 'offer' ? 'Offer' : 'Accepted', when: '', state: 'done' }
      : {
          key: 'follow',
          label: 'Follow up',
          when: applied && a.follow_up_on ? dayLabel(a.follow_up_on, today) : '',
          state: !applied || closedOut ? 'later' : followDue ? 'current' : 'later',
        },
  ];
}

/* The follow-up choices, in days after applying. */
export const FOLLOW_UP = [
  { days: 5, label: '5 days' },
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
];

export function followUpDays(a) {
  const from = parseDay(a?.applied_on);
  const to = parseDay(a?.follow_up_on);
  return from && to ? Math.round((to - from) / DAY) : null;
}

/** The closing date, as the badge says it. */
export function closingBadge(closing, today = new Date()) {
  if (!closing?.date) return null;
  const n = daysFrom(closing.date, today);
  const d = parseDay(closing.date);
  const base = { day: d.getDate(), month: d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase(), label: dayLabel(closing.date, today) };
  if (n < 0) return { ...base, tone: 'bad', text: 'This advert has closed', sub: `It closed on ${base.label}. Check it is still open before you apply.` };
  if (n === 0) return { ...base, tone: 'bad', text: 'Closes today', sub: 'Apply today, or it is gone.' };
  if (n <= 3) return { ...base, tone: 'warn', text: `Closes in ${n} day${n === 1 ? '' : 's'}`, sub: `The closing date is ${base.label}.` };
  return { ...base, tone: 'ok', text: `Closes ${base.label}`, sub: `${n} days to apply.` };
}

export const SIGN = {
  bad: { tone: 'bad', symbol: '!', word: 'Check first' },
  warn: { tone: 'warn', symbol: '?', word: 'Worth asking' },
  info: { tone: 'info', symbol: 'i', word: 'Good to know' },
};

/* What Job Seeker Pro adds to applying, for the locked rows and the pitch. */
export const APPLY_PRO = [
  'Application forms filled in for you in one click, or your answers ready to copy',
  'Screening questions answered from your own CV - nothing made up',
  'The closing date, and a reminder before it passes',
  'Warning signs in the advert: fees, bank details, WhatsApp-only contact',
  'A company snapshot: what they do, what it is likely to be like, good questions to ask',
];
