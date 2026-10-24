/*
 * Equality monitoring answers (Seekers 0.5.2, 24 Oct 2026).
 *
 * Kept ONLY in this browser (chrome.storage.local) and never sent to ATS
 * Engine: these are special category data, and the job seeker is the only
 * one who needs them - to copy into an employer's monitoring form. The
 * options are the usual UK monitoring categories (ONS 2021 census style),
 * each with "Prefer not to say".
 */
export const EQUALITY_KEY = 'atsEngineEqualityAnswers';

const NO = 'Prefer not to say';

export const EQUALITY = [
  { key: 'gender', label: 'Gender', options: ['Woman', 'Man', 'Non-binary', 'Prefer to self-describe', NO] },
  { key: 'gender_birth', label: 'Gender the same as registered at birth', options: ['Yes', 'No', NO] },
  { key: 'age', label: 'Age band', options: ['16-24', '25-34', '35-44', '45-54', '55-64', '65 or over', NO] },
  { key: 'ethnicity', label: 'Ethnic group', options: [
    'White - English, Welsh, Scottish, Northern Irish or British', 'White - Irish', 'White - Gypsy or Irish Traveller', 'White - Roma',
    'Any other White background', 'Mixed - White and Black Caribbean', 'Mixed - White and Black African', 'Mixed - White and Asian',
    'Any other Mixed or multiple ethnic background', 'Asian or Asian British - Indian', 'Asian or Asian British - Pakistani',
    'Asian or Asian British - Bangladeshi', 'Asian or Asian British - Chinese', 'Any other Asian background',
    'Black, Black British, Caribbean or African - African', 'Black, Black British, Caribbean or African - Caribbean',
    'Any other Black, Black British or Caribbean background', 'Arab', 'Any other ethnic group', NO] },
  { key: 'disability', label: 'Disability or long-term condition', options: ['Yes', 'No', NO] },
  { key: 'orientation', label: 'Sexual orientation', options: ['Heterosexual or straight', 'Gay or lesbian', 'Bisexual', 'Other', NO] },
  { key: 'religion', label: 'Religion or belief', options: ['No religion', 'Christian', 'Buddhist', 'Hindu', 'Jewish', 'Muslim', 'Sikh', 'Any other religion', NO] },
  { key: 'caring', label: 'Caring responsibilities', options: ['Yes', 'No', NO] },
];

/** Keep only known keys and known options - nothing else is ever stored. */
export function cleanEquality(values) {
  const out = {};
  for (const q of EQUALITY) {
    const v = values?.[q.key];
    if (typeof v === 'string' && q.options.includes(v)) out[q.key] = v;
  }
  return out;
}

export async function loadEquality(storage = chrome.storage.local) {
  try {
    return cleanEquality((await storage.get(EQUALITY_KEY))?.[EQUALITY_KEY]);
  } catch {
    return {};
  }
}

export async function saveEquality(values, storage = chrome.storage.local) {
  const clean = cleanEquality(values);
  if (Object.keys(clean).length) await storage.set({ [EQUALITY_KEY]: clean });
  else await storage.remove(EQUALITY_KEY);
  return clean;
}

/* The common questions' answer choices (the server keeps the text). */
export const CHOICES = {
  yesno: ['Yes', 'No'],
  choice: ['Yes', 'No', 'Open to it'],
};
