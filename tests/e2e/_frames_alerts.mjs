import { launch } from './harness.js';
const OUT = '/tmp/claude-0/-home-claude/c3ccf0b1-91f6-5fc4-a171-7c6e3e76b034/scratchpad';
const x = await launch('seeker', '<!doctype html><title>Delivery Manager</title><h1>Delivery Manager</h1>');
const USER = { name: 'Amy Jones', organisation: 'Amy Jones' };
await x.connectAs(USER, 'seeker');
await x.mockApi({
  'GET /extension/me': [200, { user: USER, role: 'seeker', cv_count: 2, my_cv: { id: 9, version_number: 3 }, job_insight: true, candidate_id: 7, documents: true }],
  'GET /extension/alerts': [200, { messages: 1, emails: 2, total: 3, latest_emails: [{ from: 'Jane Smith', subject: 'Interview on Tuesday', at: '2026-10-26T10:00:00Z' }], paths: { messages: '/communications', emails: '/emails' } }],
});
const popup = await x.popup();
await popup.setViewportSize({ width: 400, height: 760 });
await popup.getByTestId('alert-banner').waitFor();
await popup.waitForTimeout(500);
await popup.screenshot({ path: `${OUT}/alerts-panel.png` });
await x.close();
