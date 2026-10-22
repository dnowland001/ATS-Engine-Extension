/*
 * The vacancy fields a recruiter reviews before saving, and the words
 * the popup uses for them. Shared so both extensions label things the
 * same way ATS Engine does.
 */
export const VACANCY_FIELDS = [
  { key: 'title', label: 'Job title', required: true },
  { key: 'company', label: 'Employer', required: true },
  { key: 'location', label: 'Location' },
  { key: 'salary', label: 'Salary' },
  { key: 'job_type', label: 'Contract type' },
  { key: 'hours', label: 'Working hours' },
  { key: 'description', label: 'Job description', required: true, multiline: true },
];

export const DUPLICATE_REASONS = {
  same_link: 'Same link',
  same_title_and_employer: 'Same title and employer',
  same_title_and_location: 'Same title and location',
};

/** The fields to send: trimmed, empty ones left out, never invented. */
export function cleanFields(values) {
  const out = {};
  for (const { key } of VACANCY_FIELDS) {
    const v = typeof values[key] === 'string' ? values[key].trim() : '';
    if (v) out[key] = v;
  }
  if (values.source_url) out.source_url = values.source_url;
  return out;
}

/** Labels of required fields still empty. */
export function missingRequired(values) {
  return VACANCY_FIELDS.filter((f) => f.required && !(typeof values[f.key] === 'string' && values[f.key].trim())).map((f) => f.label);
}

/* A candidate read from another site (Professional, E2, 22 Oct 2026). */
export const CANDIDATE_FIELDS = [
  { key: 'full_name', label: 'Name', required: true },
  { key: 'email', label: 'Email', required: true },
  { key: 'phone', label: 'Phone' },
  { key: 'headline', label: 'Current or wanted role' },
  { key: 'town', label: 'Town' },
];

export const MATCH_REASONS = { same_email: 'Same email', same_phone: 'Same phone', similar_name: 'Similar name' };

/** The candidate fields to send: trimmed, empty ones left out, never invented. */
export function cleanCandidate(values) {
  const out = {};
  for (const key of [...CANDIDATE_FIELDS.map((f) => f.key), 'profile_text']) {
    const v = typeof values[key] === 'string' ? values[key].trim() : '';
    if (v) out[key] = v;
  }
  return out;
}
