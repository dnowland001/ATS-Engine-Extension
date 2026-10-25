import { launch } from './harness.js';
const OUT = '/tmp/claude-0/-home-claude/c3ccf0b1-91f6-5fc4-a171-7c6e3e76b034/scratchpad/p6';
const FORM = `<!doctype html><html><head><meta charset="utf-8"><title>Apply - Delivery Manager | Calder Bank</title><style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;background:#f4f6f9;padding:26px 0 0 60px}
.site{font-weight:700;font-size:20px;color:#334;margin-bottom:18px}.site span{color:#8a94a6;font-weight:500}
.card{background:#fff;border:1px solid #e1e6ee;border-radius:14px;padding:24px 30px;width:860px}
h1{margin:0 0 4px;font-size:26px;color:#0f2139}.sub{font-size:15px;color:#4b5970;margin:0 0 18px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 22px}
label{display:block;font-size:13px;font-weight:600;color:#1d2a3d;margin-bottom:5px}
input,select,textarea{width:100%;font:inherit;font-size:15px;padding:8px 11px;border:1px solid #c9d1dc;border-radius:7px;background:#fff;color:#0f2139}
textarea{height:58px;resize:none}.full{grid-column:1/-1}
button{margin-top:16px;background:#36495f;color:#fff;border:0;border-radius:8px;padding:10px 26px;font-size:15px;font-weight:600}
</style></head><body><div class="site">Calder Bank <span>&middot; Careers</span></div>
<form class="card" id="apply"><h1>Apply: Delivery Manager</h1><p class="sub">Edinburgh (hybrid) &middot; Closing 27 October</p>
<div class="grid">
<div><label for="fn">First name</label><input id="fn" name="first_name"></div>
<div><label for="ln">Last name</label><input id="ln" name="last_name"></div>
<div><label for="em">Email address</label><input id="em" type="email" name="email"></div>
<div><label for="ph">Mobile number</label><input id="ph" type="tel" name="phone"></div>
<div><label for="pc">Postcode</label><input id="pc" name="postcode"></div>
<div><label for="li">LinkedIn profile</label><input id="li" type="url" name="linkedin"></div>
<div><label for="rtw">Do you have the right to work in the UK?</label><select id="rtw"><option value="">Please select</option><option>Yes</option><option>No</option></select></div>
<div><label for="np">Notice period</label><input id="np" name="notice"></div>
<div class="full"><label for="why">Why do you want to work for Calder Bank?</label><textarea id="why"></textarea></div>
</div><button type="submit">Submit application</button></form></body></html>`;
const x = await launch('seeker', FORM);
const USER = { name: 'Amy Jones', organisation: 'Amy Jones' };
const ANS = [
  { key: 'name', label: 'Full name', value: 'Amy Jones', group: 'about' }, { key: 'email', label: 'Email', value: 'amy.jones@example.com', group: 'about' },
  { key: 'phone', label: 'Phone', value: '07700 900123', group: 'about' }, { key: 'postcode', label: 'Postcode', value: 'EH4 1DR', group: 'about' },
  { key: 'linkedin', label: 'LinkedIn', value: 'https://www.linkedin.com/in/amy-jones', group: 'links' },
  { key: 'right_to_work', label: 'Right to work in the UK', value: 'Yes', group: 'questions' }, { key: 'notice', label: 'Notice period', value: 'One month', group: 'questions' },
  { key: 'salary', label: 'Salary expectation', value: '£65,000', group: 'questions' }];
await x.connectAs(USER, 'seeker');
await x.mockApi({
  'GET /extension/me': [200, { user: USER, role: 'seeker', cv_count: 2, my_cv: { id: 9, version_number: 3 }, job_insight: true, candidate_id: 7, documents: true }],
  'GET /extension/seeker/form-answers': [200, { answers: ANS, common: [], missing: [], profile_path: '/candidate' }],
  'POST /extension/seeker/form-fill': [200, { answers: ANS }],
});
const { job, popup } = await x.popupOnJob();
await job.setViewportSize({ width: 1020, height: 606 });
await popup.setViewportSize({ width: 400, height: 1400 });
await popup.evaluate(() => { chrome.permissions.request = async () => true; });
await popup.waitForTimeout(800);
await popup.screenshot({ path: `${OUT}/home.png` });
const top = async (q) => popup.evaluate((s) => Math.round(document.querySelector(s).getBoundingClientRect().top + scrollY), q);
console.log('tool-card', await top('.tool-card'));
await popup.getByRole('button', { name: 'Open the form helper' }).click();
await popup.getByRole('button', { name: 'Fill in this form' }).waitFor();
await popup.waitForTimeout(300);
await popup.screenshot({ path: `${OUT}/helper.png` });
console.log('fill-card', await top('.fill-card'));
await job.screenshot({ path: `${OUT}/page-before.png` });
await popup.getByRole('button', { name: 'Fill in this form' }).click();
await popup.getByText(/Filled in \d+ boxes/).waitFor();
await popup.waitForTimeout(300);
await popup.screenshot({ path: `${OUT}/helper-after.png` });
await job.screenshot({ path: `${OUT}/page-after.png` });
await x.close();
