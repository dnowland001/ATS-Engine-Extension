# Store listings: Chrome Web Store and Microsoft Edge Add-ons

Everything below is copy-and-paste ready. Upload the store zips, not the
download-page zips: `npm run store` builds them into `dist/store/`
(the store gives each extension its own ID, so the `key` is left out).

Images in this folder: `recruiter-1..3.png`, `seeker-1..3.png` (1280×800
screenshots), `recruiter-tile.png`, `seeker-tile.png` (440×280 small promo
tile). The 128×128 icon is inside each zip (`icons/icon-128.png`) and in
`assets/recruiter-icon-128.png` / `assets/seeker-icon-128.png`.

---

## ATS Engine - Recruiters

**Upload:** `dist/store/ats-engine-recruiter-<version>-store.zip`

**Name:** ATS Engine - Recruiters

**Summary (max 132 characters):**
See a vacancy? Send it straight to ATS Engine. Capture, check and add job adverts from any site to your ATS Engine desk.

**Category:** Productivity → Workflow & Planning (Chrome) / Productivity (Edge)

**Language:** English (United Kingdom)

**Description:**

See a vacancy anywhere on the web? It is on your ATS Engine desk in one click.

ATS Engine - Recruiters is the browser companion to ATS Engine, the recruitment platform for agencies and in-house teams. On LinkedIn, Indeed, Reed, Totaljobs or any careers page, click the green icon and press Capture job.

WHAT IT DOES
• Captures the advert for you: title, employer, location, salary, contract, hours and the full description, laid out the way the advert lays it out. Anything the page does not show is marked "Not found on the page" – nothing is made up.
• Stops duplicates before they happen: if the vacancy looks like one you already have, it shows you first, so you can open it, fill in its gaps, or create a new one on purpose.
• Match my database: every candidate with a CV scored against the role with the same fit ATS Engine uses – who meets your minimum, who is close, and the best matches, one click from their profile.
• Advert Health: the ten checks, a score out of 100 and the biggest fixes. Warnings are things to review, not legal findings.
• Job Analysis: the essential and desirable requirements, skills, years and level found in the advert.

PRIVATE BY DESIGN
• It reads the page only when you click. Nothing runs in the background.
• It reaches only your own desk's vacancies and candidates, with its own key that expires after 30 days and can be disconnected in ATS Engine at any time.
• Nothing from a job page can run inside it.

NEEDS AN ATS ENGINE ACCOUNT
For recruiter accounts on a Recruiter seat or the 14-day free trial (not Free). Start free at https://www.ats-engine.com/start-recruiter

ATS Engine is a product of DennisNowland Ltd, registered in Scotland (SC885995).

**Website:** https://www.ats-engine.com/browser-extensions
**Support:** sales@ats-engine.com
**Privacy policy URL:** https://www.ats-engine.com/privacy#browser-extensions

---

## ATS Engine - Seekers

**Upload:** `dist/store/ats-engine-seeker-<version>-store.zip`

**Name:** ATS Engine - Seekers

**Summary (max 132 characters):**
Stop applying blindly. See a job? Check how well your CV matches it, see the gaps, and know what to do next - with ATS Engine.

**Category:** Productivity → Tools (Chrome) / Productivity (Edge)

**Language:** English (United Kingdom)

**Description:**

Stop applying blindly. Check the job right where you found it.

ATS Engine - Seekers is the browser companion to ATS Engine for job seekers. On any job advert – LinkedIn, Indeed, Reed, a company careers page – click the blue icon and press Check this job.

WHAT IT DOES
• Your match, on the advert: a score against your own minimum, from the same matching as ATS Engine's Job Analysis.
• Every requirement judged: each thing the job asks for marked Evidenced, Practised, Named only or Not evidenced.
• A next step, not a verdict: Worth applying, Tailor your CV first (with the score your own CVs could reach), or Review before applying.
• Tailor in one click: opens ATS Engine's CV Creator on that job. You check every change and nothing is invented.
• Tracked without typing: the job goes into your Application Tracker by itself – I've applied, Got an interview, Got an offer, one click each.

PRIVATE BY DESIGN
• It reads the page only when you click. Nothing runs in the background.
• Your CV stays in ATS Engine and is never stored in the extension.
• Its own key expires after 30 days and can be disconnected in ATS Engine at any time.

NEEDS AN ATS ENGINE ACCOUNT
Included with Job Seeker, Job Seeker Pro and the 14-day free trial (not Free). Start free at https://www.ats-engine.com/start-seeker

ATS Engine is a product of DennisNowland Ltd, registered in Scotland (SC885995).

**Website:** https://www.ats-engine.com/browser-extensions
**Support:** sales@ats-engine.com
**Privacy policy URL:** https://www.ats-engine.com/privacy#browser-extensions

---

## Privacy practices (both extensions – same answers)

**Single purpose:**
- Recruiters: "Capture a job advert from the page the user is viewing into the user's ATS Engine recruitment account, and show ATS Engine's analysis of it."
- Seekers: "Check a job advert from the page the user is viewing against the user's CV in their ATS Engine account, and show the match."

**Permission justifications:**
- `activeTab` – to read the job advert on the tab the user is looking at, only when they click the extension.
- `scripting` – to read that page's text when the user presses Capture job / Check this job. Nothing is changed on the page.
- `storage` – to keep the extension's own sign-in key, the user's name and organisation, and when the key expires.
- Host permission `https://api.ats-engine.com/*` – the extension's only server: the user's own ATS Engine account.

**Remote code:** No. All code is in the package; it only exchanges data (JSON) with api.ats-engine.com.

**Data usage – tick:**
- Authentication information (the extension's own sign-in key)
- Personally identifiable information (the user's name, shown in the popup)
- Website content (the job advert page, sent when the user clicks)

**Certify:**
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## After approval

Send Claude both store links. Then:
1. The store IDs are added to `EXTENSION_ALLOWED_ORIGINS` (backend `.env`) and to `config/extension.php` `roles`, so the store versions can connect.
2. The site's download buttons become **Add to Chrome** / **Get it for Edge**.
