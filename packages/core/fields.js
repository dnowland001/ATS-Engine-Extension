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
