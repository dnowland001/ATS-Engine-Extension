/* Deep links into ATS Engine - the full screens live in the app, not the popup. */
export const links = (appBase) => ({
  vacancy: (id) => `${appBase}/jobs?open=${encodeURIComponent(id)}`,
  advertHealth: (id) => `${appBase}/tools?tab=ad&posting=${encodeURIComponent(id)}`,
  gaps: () => `${appBase}/recruiter/gaps`,
  candidates: () => `${appBase}/recruiter/candidates`,
  settings: () => `${appBase}/settings`,
  // Job seeker screens.
  jobAnalysis: (id) => `${appBase}/jobs?open=${encodeURIComponent(id)}`,
  applications: () => `${appBase}/applications`,
  cvLibrary: () => `${appBase}/cv-library`,
});
