/*
 * The Application Tracker's statuses, as the app words them
 * (src/utils/applicationStatus.js in ATS Engine), and the button for each
 * move. Which moves are offered is never decided here: ATS Engine sends
 * them ("next"), from the same rules its tracker enforces.
 */
export const STATUS = {
  waiting: { label: 'Waiting', tone: 'ok' },
  longshot: { label: 'Longshot', tone: 'warn' },
  draft: { label: 'Draft', tone: 'warn' },
  applied: { label: 'Applied', tone: 'ok' },
  interviewing: { label: 'Interview', tone: 'ok' },
  offer: { label: 'Offer', tone: 'ok' },
  accepted: { label: 'Accepted', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'bad' },
  withdrawn: { label: 'Withdrawn', tone: 'bad' },
};

export const MOVE = {
  applied: "I've applied",
  interviewing: 'Got an interview',
  offer: 'Got an offer',
  accepted: 'Accepted the offer',
  rejected: 'Rejected',
  withdrawn: 'No longer interested',
};

export const statusLabel = (s) => STATUS[s]?.label || s || 'Unknown';
