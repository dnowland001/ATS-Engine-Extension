# ATS Engine browser extensions

Thin browser clients over the ATS Engine API. Chrome and Microsoft Edge (Manifest V3).

| App | Folder | Status |
|---|---|---|
| ATS Engine for Recruiters | `apps/recruiter` | Phase 1 – capture a job advert into ATS Engine |
| ATS Engine for Job Seekers | `apps/seeker` | Next (SysMon plan 11.7) – reuses everything in `packages/core` |

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
npm run build              # production  -> dist/recruiter
npm run build:local        # localhost:8000 API, localhost:5173 app
node scripts/build.mjs --zip   # also dist/ats-engine-recruiter-<version>.zip for the stores
```

## Load it in Chrome or Edge

1. `npm run build`
2. Chrome: `chrome://extensions` · Edge: `edge://extensions`
3. Turn on **Developer mode**, click **Load unpacked**, choose `dist/recruiter`.
4. The ID is always **`fmgfdjfhhjdkciahjdlgiefgelffglml`** (fixed by `key` in the manifest), in Chrome and Edge alike. ATS Engine accepts it because the backend `.env` has
   `EXTENSION_ALLOWED_ORIGINS=chrome-extension://fmgfdjfhhjdkciahjdlgiefgelffglml` (comma-separated if more are added – e.g. the Chrome Web Store and Edge Add-ons IDs once published).

## Tests

```
npm test                    # unit (vitest)
npm run test:e2e            # builds, loads the real extension in Chromium, mocked API
CHROMIUM_PATH=/path/to/chrome npm run test:e2e   # use a Chromium already installed
```
