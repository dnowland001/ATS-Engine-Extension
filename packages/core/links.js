/* Deep links into ATS Engine - the full screens live in the app, not the popup. */
export const links = (appBase) => ({
  vacancy: (id) => `${appBase}/jobs?open=${encodeURIComponent(id)}`,
  // With the country, ATS Engine runs the check as the page opens (it never guesses one).
  advertHealth: (id, country) => `${appBase}/tools?tab=ad&posting=${encodeURIComponent(id)}${country ? `&country=${encodeURIComponent(country)}` : ''}`,
  gaps: () => `${appBase}/recruiter/gaps`,
  candidates: () => `${appBase}/recruiter/candidates`,
  candidate: (id) => `${appBase}/recruiter/candidates/${encodeURIComponent(id)}`,
  settings: () => `${appBase}/settings`,
  subscription: () => `${appBase}/subscription`,
  // Job seeker screens.
  jobAnalysis: (id) => `${appBase}/jobs?open=${encodeURIComponent(id)}`,
  applications: () => `${appBase}/applications`,
  cvLibrary: () => `${appBase}/cv-library`,
  myCv: () => `${appBase}/my-cv`,
  tailorMyCv: (jobId) => `${appBase}/my-cv?tailor=${encodeURIComponent(jobId)}`,
});
