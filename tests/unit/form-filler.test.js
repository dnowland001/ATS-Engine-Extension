// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { fillForm, fillSummary } from '../../packages/core/form-filler.js';

const ANSWERS = {
  name: 'Sam Taylor',
  email: 'sam@example.com',
  phone: '07700 900123',
  address: '12 High Street, Leith, Edinburgh, EH6 1AA',
  town: 'Edinburgh',
  postcode: 'EH6 1AA',
  linkedin: 'https://www.linkedin.com/in/samtaylor',
  right_to_work: 'Yes',
  sponsorship: 'No',
  notice: 'One month',
  salary: '£65,000',
  driving: 'Yes',
};

const run = (extra = {}) => fillForm({ answers: ANSWERS, equality: { gender: 'Woman', age: '35-44' }, ...extra });
const val = (sel) => document.querySelector(sel).value;

describe('fillForm', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <label for="fn">First name</label><input id="fn" name="first_name">
        <label for="ln">Last name</label><input id="ln" name="last_name">
        <label>Email address <input type="email" name="email"></label>
        <input name="mobile" placeholder="Mobile number">
        <input name="addr1" autocomplete="address-line1" aria-label="Address line 1">
        <label for="pc">Postcode</label><input id="pc">
        <label for="li">LinkedIn profile</label><input id="li" type="url">
        <label for="notice">What is your notice period?</label><input id="notice">
        <label for="sal">Salary expectation</label><input id="sal" value="Already typed">
        <label for="rtw">Do you have the right to work in the UK?</label>
        <select id="rtw"><option value="">Please select</option><option value="y">Yes</option><option value="n">No</option></select>
        <fieldset><legend>Will you need visa sponsorship?</legend>
          <label><input type="radio" name="sp" value="1"> Yes</label>
          <label><input type="radio" name="sp" value="0"> No</label>
        </fieldset>
        <label for="pw">Password</label><input id="pw" type="password">
        <label for="hear">How did you hear about us?</label><input id="hear">
        <label for="gender">Gender</label>
        <select id="gender"><option value="">Select</option><option>Man</option><option>Woman</option><option>Prefer not to say</option></select>
        <label for="cv">Upload your CV</label><input id="cv" type="file">
        <button type="submit">Submit application</button>
      </form>`;
  });

  it('fills the boxes it recognises with the person\'s own answers', () => {
    const res = run();
    expect(val('#fn')).toBe('Sam');
    expect(val('#ln')).toBe('Taylor');
    expect(val('input[name=email]')).toBe('sam@example.com');
    expect(val('input[name=mobile]')).toBe('07700 900123');
    expect(val('input[name=addr1]')).toBe('12 High Street');
    expect(val('#pc')).toBe('EH6 1AA');
    expect(val('#li')).toBe('https://www.linkedin.com/in/samtaylor');
    expect(val('#notice')).toBe('One month');
    expect(document.querySelector('#rtw').selectedOptions[0].textContent).toBe('Yes');
    expect(document.querySelector('input[name=sp][value="0"]').checked).toBe(true);
    expect(res.filled.length).toBe(10);
  });

  it('never overwrites, never guesses, and leaves passwords and files alone', () => {
    run();
    expect(val('#sal')).toBe('Already typed');
    expect(val('#hear')).toBe('');
    expect(val('#pw')).toBe('');
  });

  it('outlines what it filled, and fires the events a page listens for', () => {
    let heard = 0;
    document.querySelector('#fn').addEventListener('input', () => { heard += 1; });
    run();
    expect(heard).toBe(1);
    expect(document.querySelector('#fn').getAttribute('data-ats-engine-filled')).toBe('1');
    expect(document.querySelector('#hear').hasAttribute('data-ats-engine-filled')).toBe(false);
  });

  it('uses equality answers only when the person asked for them', () => {
    run();
    expect(document.querySelector('#gender').value).toBe('');
    run({ includeEquality: true });
    expect(document.querySelector('#gender').value).toBe('Woman');
  });

  it('does not press submit', () => {
    let submitted = false;
    document.querySelector('form').addEventListener('submit', (e) => { submitted = true; e.preventDefault(); });
    run();
    expect(submitted).toBe(false);
  });

  it('is safe to press twice', () => {
    run();
    const again = run();
    expect(again.filled).toEqual([]);
    expect(val('#fn')).toBe('Sam');
  });
});

describe('fillSummary', () => {
  it('counts every frame and says nothing was sent', () => {
    const s = fillSummary([{ result: { filled: [{ key: 'email' }, { key: 'phone' }] } }, { result: { filled: [{ key: 'name' }] } }]);
    expect(s.count).toBe(3);
    expect(s.text).toMatch(/Filled in 3 boxes/);
    expect(s.text).toMatch(/nothing has been submitted/);
  });

  it('says plainly when nothing matched', () => {
    expect(fillSummary([{ result: { filled: [] } }]).tone).toBe('warn');
  });
});
