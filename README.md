# ATS Engine browser extensions

Thin browser clients over the ATS Engine API. Chrome and Microsoft Edge (Manifest V3).

| App | Folder | Status |
|---|---|---|
| ATS Engine - Recruiters | `apps/recruiter` | Phase 1 – capture a job advert into ATS Engine |
| ATS Engine - Seekers | `apps/seeker` | Phase 1 – check a job against your CV: match, requirements, next step, I've applied |

## How it fits together

- **`packages/core`** – shared by both extensions: the page reader, the API client, the connection store, field labels, deep links and the look. Copied into each build as `./core`.
- **`apps/<name>`** – only what is role-specific: the popup screens, the background worker and the manifest template.
- **ATS Engine is the source of truth.** The extension reads the page the person is on (only when they click Capture), sends it to `POST /extension/capture`, shows what came back for review, and saves through the normal ATS Engine routes. Extraction, duplicates, saving, Advert Health and audit all live in ATS Engine.

### Connecting

1. Popup → **Connect to ATS Engine** opens `https://app.ats-engine.com/extension/connect?ext=<extension id>`.
2. That page (signed in to ATS Engine) gets a one-time code (5 minutes) and sends it to the extension.
3. The background worker swaps the code for the extension's own token (`POST /extension/auth/exchange`). ATS Engine only accepts it from an extension listed in `EXTENSION_ALLOWED_ORIGINS`.
4. The token lasts 30 days, can only reach the `/extension/*` routes, and is listed (and can be disconnected) under **ATS Engine → Settings → Connected browser extensions**.

### Permissions

`activeTab`, `scripting`, `storage`, plus the ATS Engine API address. No content scripts, no access to every site, no history, cookies or tabs list. The page is read only when the recruiter clicks.

## Build

```
npm install
npm run build              # production  -> dist/recruiter and dist/seeker
npm run build:local        # localhost:8000 API, localhost:5173 app
npm run zip                # also a store zip of each in dist/
```

## Load it in Chrome or Edge

1. `npm run build`
2. Chrome: `chrome://extensions` · Edge: `edge://extensions`
3. Turn on **Developer mode**, click **Load unpacked**, choose `dist/recruiter` (or `dist/seeker`).
4. The IDs are fixed by `key` in each manifest, the same in Chrome and Edge:
   - Recruiters: **`fmgfdjfhhjdkciahjdlgiefgelffglml`**
   - Job Seekers: **`fbpbkfikiogmljdnojhnhgfobinecgbm`**

   ATS Engine accepts them because the backend `.env` lists both:
   `EXTENSION_ALLOWED_ORIGINS=chrome-extension://fmgfdjfhhjdkciahjdlgiefgelffglml,chrome-extension://fbpbkfikiogmljdnojhnhgfobinecgbm`
   and the Chrome Web Store IDs (published 23 Oct 2026):
   - Recruiters: **`midipfjdnmlpfcdhggcgeelcpmoocigi`** - https://chromewebstore.google.com/detail/ats-engine-recruiters/midipfjdnmlpfcdhggcgeelcpmoocigi
   - Seekers: **`ffgpmgfpnieeabdhknepiikackpendmk`** - https://chromewebstore.google.com/detail/ats-engine-seekers/ffgpmgfpnieeabdhknepiikackpendmk
   Each store ID is also in the backend's `config/extension.php` roles.

### Seekers 0.4.0 - applying, made easy (23 Oct 2026)

- **Seen before**: a job already in their ATS Engine shows its journey - checked, applied, follow up.
- **Apply for this job**, three steps: the form helper (`GET /extension/seeker/form-answers` - their own profile, copy only, nothing typed into the page); screening answers (Pro, `POST .../jobs/{id}/screening-answer` - the Interview Centre's grounded answer agent, their own record only, 25 a day); I've applied with a follow-up reminder (`POST .../jobs/{id}/follow-up`, 5 / 7 / 14 days, the bell on the day).
- **Advert check** (Pro, `POST .../jobs/{id}/advert-check`): the closing date (kept on the tracker row; the bell two days before if not applied) and warning signs, read deterministically from the advert's own words.

### Job seeker flow

Check this job → review the captured fields → **Check my match**. That is ATS Engine's own Add a job (Job Analysis): the job is saved to the candidate's account, analysed, scored against their CVs and put in their Application Tracker as Waiting / Long shot. The popup shows the score, the band against their own minimum, each requirement's evidence (Evidenced / Practised / Named only / Not evidenced), and a next step worded only from ATS Engine's result. **I've applied** moves the tracker row to Applied.

## Tests

```
npm test                    # unit (vitest)
npm run test:e2e            # builds, loads the real extension in Chromium, mocked API
CHROMIUM_PATH=/path/to/chrome npm run test:e2e   # use a Chromium already installed
```
