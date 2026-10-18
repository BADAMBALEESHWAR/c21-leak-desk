# Profyn: order contribution and profit leak desk

**Know More. Earn Better.** Profyn is an AI-assisted profit analyst for Indian D2C brands, built for Fynd × NMIMS case **C21, Order Contribution and Profit Leak Desk**.

- **Live app:** https://d2gmrabs4sk8gk.cloudfront.net (landing `/`, app `/app/`, sign-in `/login/`, privacy `/privacy.html`)
- **Demo video:** https://d2gmrabs4sk8gk.cloudfront.net/media/profyn-demo.mp4 (1 min 49 s, captioned; also "Watch demo" on the landing page; file `web/public/media/profyn-demo.mp4`)
- **Repository:** https://github.com/BADAMBALEESHWAR/c21-leak-desk

## 1. Project and case summary

A small D2C founder sees net sales, not what each order actually leaves after refunds, returns, shipping, payment fees and ads. Profyn imports order economics, computes **operational contribution per order** with explicit refund and recovery rules, reconciles orders to channel and product totals under one attribution rule, groups the orders that lose money by cause, tests one controlled change at a time, and saves one measurable decision with its assumptions and a 30-day check.

Every rupee comes from a deterministic, tested engine. AI (Google Gemini) only explains, routes questions and drafts text; any AI sentence containing a figure the engine did not produce is rejected and replaced by template text.

Operational contribution, not statutory net profit. All demo data is synthetic (see section 7).

**Journey:** Import → Overview (top leaks and top 3 actions) → Ledger → Leaks (Fix this) → Scenario → Decision, plus Pulse owner analytics, Checks, Monthly report (PDF), Ask Profyn (text or voice) and English / हिन्दी / తెలుగు throughout.

## 2. Team, members and contributions

- **Team:** Team Conflicts in collaboration with Team Cops
- **Submission contacts:**
  - STME: Badam Baleeshwar, badambaleeshwar551@gmail.com
  - SBM: Tilak Pasupureddy, tilakpasupureddy@gmail.com

| Member (GitHub) | Track | Contribution |
|---|---|---|
| Badam Baleeshwar, BADAMBALEESHWAR (M1, STME) | 1: Platform, engine, infrastructure | API, Zod schema, calculation engine, MongoDB models, decisions and export, `/checks`, statistical confidence, Shopify and Razorpay connectors, Docker, CI, AWS deployment |
| krishna-2-005, Kuchuru Sai Krishna Reddy (M2) | 2: Interface | App screens, landing page, charts, click-to-cause ledger, Fix panel, Ask Profyn drawer, voice and PDF sharing, Hindi/Telugu UI, phone layout |
| bhavyasree72 (M3) | 3: Narrative, docs, translations | Templates, AI guardrail text, Hindi and Telugu language files, `DEMO`, `RULES`, `SNAPSHOT`, `FEEDBACK`, ADRs, MBA CSVs |
| musanivivekanand39 (M4) | 4: Data, tests, drills | Extended fixture, negative-test files, `expected.json`, Vitest suites, check harness, scenario and confidence tests |
| Tilak Pasupureddy (SBM, Team Cops) | Business | Business partner team and submission contact for SBM |

Each member's commits are on the `Track1`–`Track4` branches and merged into `main`.

## 3. Prerequisites

- Node.js 20 or later and npm
- Docker Desktop (optional, for the full stack with MongoDB)
- Microsoft Edge or Chrome (for the browser smoke test)
- For deployment only: an AWS account, AWS CLI v2 and the GitHub Actions setup in `docs/DEPLOY.md`

## 4. Install, configure, build, run, test, deploy

**Configure.** Copy `.env.example` to `.env`. It lists every variable with no real values. Nothing is required for a local run: with all values empty, the API uses an in-memory store, template text instead of AI, local file storage and no sign-in.

```
cp .env.example .env
```

**Install**

```
npm run setup              # root, api and web dependencies
```

**Run (option A, full stack with MongoDB in Docker)**

```
docker compose up -d --build     # landing http://localhost:3000, app http://localhost:3000/app/, API http://localhost:8080
npm run check                    # four public checks, prints PASS ×4
docker compose down              # stop (add -v to delete the local database volume)
```

**Run (option B, without Docker)**

```
npm run dev:api            # API on http://localhost:8080 (health: /api/v1/health)
npm run dev:web            # landing http://localhost:5173, app http://localhost:5173/app/
```

**Build**

```
npm run build              # API (TypeScript) and web (Vite)
```

**Test**

```
npm test                                            # all Vitest suites, then the performance suite on its own
BASE_URL=http://localhost:8080 npm run check         # four public checks against a running API
WEB_URL=http://localhost:5173 npm run ui:smoke       # 12-step browser test (needs dev:web running)
```

**Deploy.** Every push to `main` runs CI and then deploys automatically to AWS ap-south-1: web to S3 behind CloudFront, the API image to ECR, then a restart on EC2 through SSM. Secrets are stored encrypted in AWS SSM Parameter Store, never in the repository. To push sign-in, AI and payment settings from a local `.env.oauth` to SSM and restart the API, run `bash infra/v2-setup.sh`. First-time setup is in `docs/DEPLOY.md`.

## 5. Sample inputs and expected outputs

| Input (Import screen, or `data/`) | Expected output |
|---|---|
| Load sample orders (`data/C21/fixture.json`, 20 orders) | Contribution ₹6,000, reconciled across orders, channels and products |
| Load extended sample (`data/C21_extended.json`) | Contribution ₹7,053 in both attribution modes |
| Worked order (Ledger → Worked order) | ₹230 = 1,000 − 200 − 400 − 50 − 100 − 20 |
| Load 12-month demo (`data/demo_12m.json`, 3,020 orders) | Contribution ₹3,85,157 (partial, 5 orders with missing facts); top fix Cap discount +₹1,10,365, High confidence |
| `data/negative_tests/*` (duplicate, late refund, null refund, missing fee, refund over gross, recovery 400, bad schema, bad values) | Each flagged with its line and reason; nothing silently zeroed |
| CSV template (Import → Download CSV template) | The columns and aliases accepted on upload |

**The four public checks**

| # | Where | Expected |
|---|---|---|
| 1 | Ledger → **Worked order** | ₹230: revenue 1,000 − refund 200 − net product cost 400 − shipping 50 − ads 100 − handling 20 |
| 2 | Fixture or extended sample → Ledger → switch attribution | Σ orders = Σ channels = Σ products: ₹6,000 on the fixture, ₹7,053 on the extended file, in both modes; ads never deducted twice |
| 3 | **Missing refund** sample → Scenario → recovery ₹350 → ₹200 | O05 unknown (₹6,180 partial); recommendation moves from charge return shipping (₹150) to raise recovery via inspection (₹480) |
| 4 | Ledger → **Unit economics** on the worked order | Net revenue ₹800, CM1 50%, CM2 41.25%, CM3 28.75% |

All expected values live in `data/expected.json`. `GET /api/v1/checks` returns the four checks with the working for each line, with no login.

## 6. Architecture and business rules

- **Web:** React 18 + Vite, multi-page (landing, app, login), English/Hindi/Telugu (i18next).
- **API:** Node.js, Express, TypeScript, Zod validation.
- **Database:** MongoDB 7.
- **Hosting:** AWS Mumbai (ap-south-1): CloudFront, S3, EC2 with Docker, ECR, SSM Parameter Store, CloudWatch, Cognito.

| Path | Contents |
|---|---|
| `api/src/engine/` | Pure calculation rules: validation, contribution, reconciliation, leaks, scenarios, recommendation, Pulse |
| `api/src/stats/evidence.ts` | Statistical confidence: bootstrap over the owner's orders (1,000 resamples, 95% range) |
| `api/src/ai/` | Templates, Gemini adapter, model fallback chain, number-grounding guard, Ask tools |
| `api/src/connectors/`, `api/src/routes/razorpay.ts` | Shopify Admin API connector, Razorpay payment links |
| `api/src/routes/` | REST API (contract in `docs/API.md`) |
| `web/src/` | Screens, components, charts, translations (`web/src/i18n/`) |
| `infra/`, `.github/workflows/` | Docker, AWS scripts, CI and deploy |
| `data/` | Fixture (untouched), synthetic extensions, negative tests, expected values |

**Business rules**

- `null` means unknown, never zero; an order with a missing fact has no contribution and totals are labelled partial.
- Net product cost is product cost minus recovered cost, subtracted once.
- Ads are deducted per order (allocate) or once per channel (channel spend), never both. Attribution is allocation, not causation.
- Handling is ₹0 unless a row supplies it (labelled estimate).
- A refund dated after the period end is a prior-period adjustment, shown beside the period total.
- Scenarios change one assumption at a time on a copy of the data; the baseline never changes, and the delta always equals scenario minus baseline.
- AI never computes a rupee.
- AI is off for uploaded customer data unless the signed-in owner switches it on.

## 7. Test records

Tests were run on a Windows laptop (Node 22, Edge) and against the live site on 18 October 2026.

| # | Setup | Scenario | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | `npm test` | All unit, API and UI (jsdom) suites | All pass | 429 passed in 41 files, plus 4 performance tests | Pass |
| 2 | `npm run check` against the live site | Check 1: worked order | ₹230 | ₹230 | Pass |
| 3 | same | Check 2: reconciliation, both modes | 7,053 = 7,053, never both | 7,053 = 7,053 (never both: true) | Pass |
| 4 | same | Check 3: unknown labelled, recommendation changes | charge return shipping → raise recovery | as expected | Pass |
| 5 | same | Check 4: margins on the worked order | Net revenue 800, CM1 50%, CM2 41.25%, CM3 28.75% | as expected | Pass |
| 6 | `npm run ui:smoke` against the live site | 12-step browser journey | 12/12 | 12/12 | Pass |
| 7 | Browser error sweep, live site | 29 screens and drills | 0 console or HTTP errors | 0 problems | Pass |
| 8 | Browser test, live Scenario page | Each control (return rate, recovery, shipping, refund policy, ads) at two values, back again, then reset | Dependent figures move; delta = scenario − baseline; same result after back-and-forth; reset restores baseline | As expected on all 5 controls | Pass |
| 9 | Live site, Hindi and Telugu | 9 app screens scanned for English sentences | 0 | 0 in both languages | Pass |
| 10 | Live AI run on the 12-month demo | Autopilot, Fix Advisor, 6 Ask questions in 3 languages, monthly digest | AI text grounded in engine numbers | 20 accepted, 0 rejected, 0 failed | Pass |
| 11 | Performance suite | 10,000 synthetic orders (fixture rows repeated) | Validate and analyse in under 2 s | Under 2 s | Pass |
| 12 | Manual, live site | Google and GitHub sign-in | User and login stored in MongoDB | Both stored (`users`, `logins`) | Pass |

**Labels**

- **Synthetic data:** the fixture, `C21_extended.json` (rows S01–S08 marked `synthetic: true`) and `demo_12m.json` (3,020 generated orders, all `synthetic: true`). None of it is real brand data.
- **Mocks:**
  - Gemini is replaced by a stub model in automated tests. Live runs (row 10) use the real API.
  - The Shopify and Razorpay APIs, and the Google/GitHub OAuth providers, are mocked with a stubbed `fetch` in tests.
- **Load:** row 11 is the only load condition, and it uses replicated synthetic rows. No stress test beyond it was run.

**Not run or not yet verified**

- **Shopify:** the connector has not been run against a real store (no store token yet). Only the mocked tests and a live check that the server reaches Shopify have been done.
- **Razorpay:** payment-link creation is configured (test keys) but has not been exercised end to end in a signed-in session.
- **Failing tests:** none.

## 8. AI, third-party services, integrations and data sources

- **AI:** Google Gemini (`gemini-3.5-flash`, with fallback models). It is used for explanations, Ask Profyn tool selection and phrasing, the monthly digest and column mapping. Every AI output carries a badge, and the template text is the fallback.
- **Third-party services:**
  - AWS (hosting, storage, secrets, email sign-in through Cognito).
  - Google and GitHub OAuth (sign-in).
  - Razorpay (payment links, test mode).
  - Shopify Admin API (read-only order import).
  - Open-source libraries listed in each `package.json`.
- **Mocked or not live:**
  - The Shopify connector works but is untested on a real store.
  - Amazon, Flipkart, Myntra, Meta Ads and Google Ads are report-file importers or roadmap items. None is shown as connected.
- **Data sources:**
  - The C21 case fixture.
  - Synthetic extensions generated by `scripts/gen-demo.mjs` with a fixed seed.
  - Owner-uploaded CSV/JSON files.
- **Pitch and supporting evidence:**
  - Product and pitch outline: `docs/PRODUCT.md`
  - Market: `docs/MARKET.md`
  - Scope: `docs/SCOPE.md`
  - Rules: `docs/RULES.md`
  - Trust and data handling: `docs/TRUST.md`
  - Feedback and change log: `docs/FEEDBACK.md`
  - Snapshot: `docs/SNAPSHOT.md`
  - Sample decision: `docs/sample_decision.json`
  - MBA workbooks: `docs/mba/`
  - Demo video: link at the top of this file

## 9. Reproducing the submitted result

1. Clone the repository and run `npm run setup`.
2. Start the stack with `docker compose up -d --build`, or with `npm run dev:api` and `npm run dev:web`.
3. Run `npm test`. Expect every suite to pass.
4. Run `BASE_URL=http://localhost:8080 npm run check`. Expect PASS ×4.
5. Open the app, choose **Load 12-month demo**, and compare with section 5: contribution ₹3,85,157 and top fix Cap discount +₹1,10,365.
6. The live site at https://d2gmrabs4sk8gk.cloudfront.net runs the same commit as `main`.

## 10. Known limitations

- MongoDB runs in Docker on one EC2 instance. There is no database password and the data disk is not encrypted; the database is not reachable from the internet. Uploaded files in S3 are encrypted, and the database is backed up to S3 every hour.
- Scenarios change one assumption at a time.
- Money is in whole rupees; paise are not modelled.
- Statistical confidence measures how stable a fix's gain is across the owner's own orders. It does not predict customer behaviour, for example whether customers accept a return-shipping charge.
- The Gemini free tier allows about 5 requests a minute per model. Busy periods fall back to template text.
- Synthetic data only. Nothing here is evidence about real founders, prices or demand.
