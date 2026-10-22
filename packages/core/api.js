/*
 * The one way the extensions talk to ATS Engine (21 Oct 2026).
 *
 * Every call goes to the ATS Engine API with the extension's own token -
 * never the app's login - and every failure comes back as an ApiError
 * with a message a person can act on. ATS Engine stays the source of
 * truth: nothing here caches or computes anything of its own.
 */
export class ApiError extends Error {
  constructor(message, { status = 0, code = '', body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const MESSAGES = {
  0: 'Cannot reach ATS Engine just now. Check your connection and try again.',
  401: 'Your connection to ATS Engine has ended. Connect again to carry on.',
  402: 'This needs an active ATS Engine plan. Open ATS Engine to check your subscription.',
  403: 'Your account cannot do this from the extension.',
  404: 'That is no longer in ATS Engine.',
  413: 'This page is too large to capture. Highlight the job description and try again.',
  429: 'Too many requests in a short time. Wait a minute and try again.',
};

export function createApi({ baseUrl, getToken, onUnauthorised = () => {}, fetchImpl = (...a) => fetch(...a), timeoutMs = 20000 }) {
  async function request(path, { method = 'GET', body, token, retry = method === 'GET' } = {}) {
    const auth = token ?? (await getToken());
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) headers.Authorization = `Bearer ${auth}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: 'omit',
      });
    } catch {
      if (retry) {
        return request(path, { method, body, token, retry: false });
      }
      throw new ApiError(MESSAGES[0]);
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (res.ok) return data;

    if (res.status === 401) {
      await onUnauthorised();
    }
    const firstValidation = data?.errors ? Object.values(data.errors).flat()[0] : null;
    const message =
      res.status === 422 && firstValidation
        ? firstValidation
        : data?.message && res.status !== 401
          ? data.message
          : MESSAGES[res.status] || `ATS Engine could not do that (error ${res.status}).`;
    throw new ApiError(message, { status: res.status, code: data?.error || '', body: data });
  }

  return {
    request,
    exchange: (code, deviceName) =>
      request('/extension/auth/exchange', { method: 'POST', body: { code, device_name: deviceName }, token: '' }),
    me: () => request('/extension/me'),
    disconnect: () => request('/extension/auth/token', { method: 'DELETE' }),
    capture: (page) => request('/extension/capture', { method: 'POST', body: { url: page.url, html: page.html, selection: page.selection } }),
    // Recruiter extension.
    createVacancy: (fields, { createNew = false } = {}) =>
      request('/extension/recruiter/jobs', { method: 'POST', body: { ...fields, ...(createNew ? { create_new: true } : {}) } }),
    fillVacancy: (id, fields) => request(`/extension/recruiter/jobs/${id}/fill`, { method: 'POST', body: fields }),
    advertHealth: (id) => request(`/extension/recruiter/jobs/${id}/advert-health`, { method: 'POST', body: {} }),
    jobAnalysis: (id) => request(`/extension/recruiter/jobs/${id}/analysis`),
    matchDatabase: (id) => request(`/extension/recruiter/jobs/${id}/match-database`, { method: 'POST', body: {} }),
    // ATS Engine Professional (E1): the vacancy's intelligence.
    vacancyIntelligence: (id) => request(`/extension/recruiter/jobs/${id}/intelligence`),
    // ATS Engine Professional (E2): a candidate on another site. Nothing is saved until addCandidate.
    captureCandidate: (page) => request('/extension/recruiter/candidates/capture', { method: 'POST', body: { url: page.url, html: page.html, selection: page.selection } }),
    candidateContext: (fields) => request('/extension/recruiter/candidates/context', { method: 'POST', body: fields }),
    addCandidate: (fields) => request('/extension/recruiter/candidates', { method: 'POST', body: { ...fields, confirmed: true } }),
    // Job seeker extension.
    checkMatch: (fields) => request('/extension/seeker/jobs', { method: 'POST', body: fields }),
    markApplied: (jobId) => request(`/extension/seeker/jobs/${jobId}/applied`, { method: 'POST', body: {} }),
    seekerApplication: (jobId) => request(`/extension/seeker/jobs/${jobId}/application`),
    setStatus: (jobId, status) => request(`/extension/seeker/jobs/${jobId}/status`, { method: 'POST', body: { status } }),
    // Job Insight (E3): Job Seeker Pro and its trial.
    jobInsight: (jobId) => request(`/extension/seeker/jobs/${jobId}/insight`),
  };
}
