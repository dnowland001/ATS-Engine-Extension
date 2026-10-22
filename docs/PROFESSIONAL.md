# The extensions' Professional upgrade (E1-E4, 22 Oct 2026)

ATS Engine Professional and Job Seeker Pro inside the **two existing
extensions** - no third extension. Both stay thin clients: every score, gap,
match and next step is worked out by ATS Engine and only put into words in
the popup. Nothing here stores a CV, a candidate or a token in a page.

| Extension | Version | Standard (unchanged) | Upgrade |
|---|---|---|---|
| ATS Engine - Recruiters | 0.4.1 | Capture job, Match my database, Advert Health, Job Analysis | ATS Engine Professional: **Professional insight** on a vacancy (E1), **Capture candidate** (E2) |
| ATS Engine - Seekers | 0.3.2 | Check my match, requirements judged, Tailor my CV, tracker | Job Seeker Pro and its trial: **Job Insight** (E3) |

## Who gets what - always decided by the server

| Feature | Allowed for | Refused with |
|---|---|---|
| Professional insight, Capture candidate | A recruiter-side account holding the `intelligence_centre` capability: an ATS Engine Professional subscriber, any seat in a Professional organisation, Org 1 (`org.capability` middleware, `ProfessionalEntitlement`) | 402 `plan_feature_unavailable` + the Professional offer |
| Job Insight | Plans with `seeker_job_insight`: Job Seeker Pro, the 14-day trial (and the recruiter tiers) - `plan.feature` middleware | 402 `plan_feature_unavailable` + the Job Seeker Pro offer |

`GET /extension/me` tells the popup what to offer - `capabilities` (recruiter)
and `job_insight` (seeker) - but the route checks again on every request, so
a hidden button is a courtesy, never the lock.

## Routes (all under `/api/v1/extension`, extension token only)

| Method and path | What it does | Saves | Throttle | Audit event |
|---|---|---|---|---|
| `GET recruiter/jobs/{id}/intelligence` | E1. Coverage against the desk's minimum, must-haves nobody in the pool shows, open gaps on the vacancy, strong matches not yet approached (town only), next steps with Next best action points. Up to 30 steps and 50 matches. | nothing | 12/min | `extension.vacancy_intelligence` |
| `POST recruiter/candidates/capture` | E2. Reads the page or highlighted text: name (main heading), email and phone as written, text to match. Nothing guessed. **LinkedIn refused** (`config/extension.php` `candidate_blocked_hosts`) with 422 `site_not_allowed`. | nothing | 30/min | `extension.candidate_capture` / `_refused` |
| `POST recruiter/candidates/context` | E2. The reviewed fields against the desk's own Talent Pool only: same email, same phone, similar name - listed, never merged. History for a person found by email or phone. Where they fit across open vacancies (Match my database's scorer; the page text as an in-memory CV for someone new, never stored). Next steps. | nothing | 12/min | `extension.candidate_context` |
| `POST recruiter/candidates` | E2. Adds them to the Talent Pool - only with `confirmed: true` - through the Talent Pool's own add (`createPlaceholderCandidate`, unchanged). | the candidate | 20/min | `extension.candidate_added` |
| `GET seeker/jobs/{id}` | 0.3.2. A saved or tracked job of the candidate's own, with its fit, so a job already in the tracker shows its score straight away. | nothing | - | - |
| `POST seeker/documents/generate`, `GET seeker/documents/{id}`, `GET seeker/documents/{id}/download` | 0.3.2. The full analysis (a tailored CV, plan feature `documents_enabled`), its score once done, and the CV download - the same generate the app uses. | the tailored CV | 10/min | - |
| `GET seeker/jobs/{id}/insight` | E3. Verdict, strongest/weakest criteria, gaps to fix first with how, skills another CV shows better, similar applications' outcomes, one next step. Only the candidate's own saved or tracked job. | nothing | 20/min | `extension.seeker.insight` |

Reused, not rebuilt: `CandidateCoverageDetector::findingFor`,
`SkillsMatchDetector::poolFindingFor` and `OpportunityFinder::liveFor` (the
nightly sweep's own logic for one vacancy), `NextBestActionService` and its
weights, `TalentPool`, `NameSimilarity`, `CandidateFitCalculator`,
`ScoreBand`, `GapSweep::categoriesFor`.

## Popup states

**Recruiter**
- Home: Capture job; for Professional also a gold *Looking at a candidate?* card with **Capture candidate**.
- After saving a vacancy: Match my database / Advert Health / Job Analysis; Professional gets **Professional insight**, Standard a one-line PRO teaser.
- Professional insight: coverage box, must-haves, Next steps, Strong matches, Open gaps - each list 3 at a time with Previous / Next, each item with its own button.
- Capture candidate: review form (Name and Email required to add) -> Check against ATS Engine -> *already in your Talent Pool* (record, applications, open gaps) or *not in your Talent Pool yet* / *possibly already in ATS Engine* (similar names) -> Where they fit -> Next steps -> **Add to Talent Pool** -> confirmation (*Yes, add them* / *Not now*).
- A 402 from a Professional route shows the Professional offer in place (e.g. just after a downgrade), never an error.

**Job seeker**
- The fit: a ring with the score. Until the full analysis is done it says the score is before the full analysis and offers **Run the full analysis**; once done it shows the tailored CV's score and **Download CV**. A job already in the Application Tracker shows its fit as soon as the popup opens.
- After Check my match: Job Seeker Pro and the trial get the **Job Insight** card (verdict, Next step with button, strong / lose marks, Fix these first, You have this, history). Job Seeker gets *Know if this job is worth your evening* - the five things Job Insight does, free in the trial, **Upgrade to Job Seeker Pro** - and the popup never asks for the insight.

## Downgrade (E4)

Moving a desk back to Standard, or a job seeker from Job Seeker Pro to Job
Seeker, deletes nothing: vacancies, candidates, gaps, opportunities, jobs and
tracker rows all stay. The Professional routes return 402 with the offer,
`/extension/me` stops listing the capabilities, and every Standard tool
carries on. Upgrading again brings the extras straight back. Covered by
`tests/Feature/ExtensionDowngradeTest.php` (backend).

## Selling Job Insight

Built and switched off until the new Seekers extension is live in the stores:
`JOB_INSIGHT_ADVERTISED=true` on the server (Job Seeker Pro's features in the
app) and `python ops/job-insight-launch.py show` in the mainsite repo. Steps:
`mainsite/ops/JOB-INSIGHT-LAUNCH.md`.

## Tests

- Extension: `tests/unit` (`professionalSummary`, `candidateSummary`, `insightSummary`, `pageSlice`) and `tests/e2e` (real Chromium, both extensions, Standard and Professional paths, refusals, paging, confirmation before adding).
- Backend: `ExtensionVacancyIntelligenceTest`, `ExtensionCandidateContextTest`, `ExtensionSeekerInsightTest`, `ExtensionDowngradeTest`, `ExtensionSeekerFullFitTest`.
