/* Deep links into ATS Engine - the full screens live in the app, not the popup. */
function toBase64Url(text) {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const links = (appBase) => ({
  vacancy: (id) => `${appBase}/jobs?open=${encodeURIComponent(id)}`,
  // Job Postings with the Add a vacancy form filled (22 Oct 2026). In the
  // fragment, so the advert never goes to the server in a URL; ATS Engine
  // reads it on page load (utils/vacancyPrefill.js in the app).
  newVacancy: (fields) => `${appBase}/jobs#prefill=${toBase64Url(JSON.stringify(fields || {}))}`,
  // With the country, ATS Engine runs the check as the page opens (it never guesses one).
  advertHealth: (id, country) => `${appBase}/tools?tab=ad&posting=${encodeURIComponent(id)}${country ? `&country=${encodeURIComponent(country)}` : ''}`,
  gaps: () => `${appBase}/recruiter/gaps`,
  candidates: () => `${appBase}/recruiter/candidates`,
  candidate: (id) => `${appBase}/recruiter/candidates/${encodeURIComponent(id)}`,
  settings: () => `${appBase}/settings`,
  // A route ATS Engine itself gave (Professional's gaps and next steps carry their own).
  route: (path) => (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? `${appBase}${path}` : `${appBase}/`),
  professional: () => `${appBase}/intelligence`,
  team: () => `${appBase}/users`,
  subscription: () => `${appBase}/subscription`,
  // Job seeker screens.
  jobAnalysis: (id) => `${appBase}/jobs?open=${encodeURIComponent(id)}`,
  applications: () => `${appBase}/applications`,
  cvLibrary: () => `${appBase}/cv-library`,
  myCv: () => `${appBase}/my-cv`,
  tailorMyCv: (jobId) => `${appBase}/my-cv?tailor=${encodeURIComponent(jobId)}`,
});
