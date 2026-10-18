# Profyn: order contribution and profit leak desk (C21)

**Know More. Earn Better.** Profyn ("profit + insights") answers Fynd × NMIMS case C21, Order Contribution and Profit Leak Desk.

Live site: **https://d2gmrabs4sk8gk.cloudfront.net** (AWS Mumbai: CloudFront, S3, EC2, Cognito; every push to `main` redeploys). Steps: `docs/DEPLOY.md`.

A small D2C founder sees net sales, not contribution.
Profyn imports order economics, computes operational contribution per order with explicit refund and recovery semantics,
reconciles orders to channel and product totals under one attribution rule, finds the orders that lose money,
compares one controlled cost or refund scenario, and saves one measurable decision with its assumptions.
Every number comes from a deterministic, tested engine; template text (or, optionally, AI) only words it.

Operational contribution, not statutory net profit. The fixture and every added row are synthetic teaching data; no claim of live revenue or production readiness.

## Demo

- **Live:** https://d2gmrabs4sk8gk.cloudfront.net. "Try the demo" opens the app on synthetic sample data with no sign-in; "Watch demo · 2 min" on the landing page plays the recording.
- **Recording:** `web/public/media/profyn-demo.mp4` (1 min 49 s, captioned), served at `/media/profyn-demo.mp4`.
- **Proof in the app:** `#/checks` shows the four checks line by line, `#/changelog` the refund and recovery semantics, `#/report` a printable monthly report.
- **Edit a flagged row:** Import → flagged rows → Edit. The correction is saved as a new dataset version with an audit trail; the original stays as it was.
- **Decision export:** `docs/sample_decision.json` is a saved decision with its starting state, scenario, assumptions and 30-day check.
- **Languages:** English, हिन्दी, తెలుగు (switch in the top bar).
- **Scope:** `docs/SCOPE.md`. **Snapshot:** `docs/SNAPSHOT.md`.

## MVP and USPs

**MVP: one journey, five steps.** Import order economics → Ledger with contribution per order that reconciles to channel and product totals → Leaks grouped by cause → Scenario with one controlled change → Decision with an assumption snapshot, 30-day test and stop rule.

**Beyond the journey**

- **Pulse owner analytics**, a sixth screen: Overview, Months, Products, Channels & payments and Leaks over time, with three actions ranked by recoverable ₹. It reads the same reconciled orders as the ledger. "Load 12-month demo" on Import opens it on 3,020 labelled synthetic orders (Oct 2025–Sep 2026).
- **Several files at once**: select or drop up to 12 CSV/JSON files (for example one per month) and they are merged into one dataset; every flag names its file and line. `node scripts/split-months.mjs <orders.json> <out-dir>` turns any orders file into monthly CSVs to try it. Best and weakest months appear only when there are at least two months to compare.
- **Accounts**: Profyn's own login page at `/login/` (sign in, create account with an email code, reset password) on Amazon Cognito. A signed-in owner's uploads, analyses and decisions are saved in MongoDB under their account and open straight into their dashboard; new uploads can be added to saved data, and orders already saved are skipped. **Try the demo** opens the owner dashboard on the 12-month synthetic brand without an account; `/checks` and deep links never need a login.
- **Landing page and app**: the landing page is at `/` and the app at `/app/`. Old links such as `/#/ledger?load=extended` redirect to `/app/#/ledger?load=extended`.

**What makes it different**

1. Refund and recovery facts before any profit headline: the margin stays hidden until they are complete.
2. Every rupee is deterministic and auditable; AI only rewords text and is rejected if it adds a number.
3. Ads are never deducted twice: switch attribution and the totals stay reconciled.
4. Unknown is a value, never zero: partial totals and labelled assumptions.
5. One controlled change leads to one measurable decision.
6. Works from a CSV today (template and column aliases; 10,000 orders analysed in under 1 s), with the same contract for Fynd order APIs tomorrow.
7. Proof built in: `/checks`, the checks panel, `make check` PASS ×4 and CI from a clean clone.

Details, proof for each claim and the pitch outline: `docs/PRODUCT.md`. Similar products and how Profyn sells: `docs/MARKET.md`. AWS deploy for profyn.in: `docs/DEPLOY.md`.

## Run it

```
docker compose up -d --build     # or: make up      → landing http://localhost:3000, app http://localhost:3000/app/, api http://localhost:8080
npm run check                    # or: make check   → PASS ×4
```

Without Docker (Node 20+; the API uses an in-memory store when `MONGO_URL` is empty):

```
npm run setup
npm run dev:api                  # http://localhost:8080/api/v1/health
npm run dev:web                  # landing http://localhost:5173, app http://localhost:5173/app/
npm test                         # 154 Vitest tests in 10 files: engine, reconcile, validate, scenario, api, auth, pulse, ai-guard, fuzz, perf
npm run ui:smoke                 # 12 steps in Edge: landing, the journey, the checks panel, multi-file upload, Pulse (needs dev:web running)
npm run check
```

## The four public checks

| # | Where | Expected |
|---|---|---|
| 1 | Ledger → **Worked order** | ₹230: revenue 1,000 − refund 200 − net product cost 400 − shipping 50 − ads 100 − handling 20 |
| 2 | Load the fixture or the extended sample → Ledger → switch attribution | Σ orders = Σ channels = Σ products: ₹6,000 on the fixture, ₹7,053 on the extended file, in both modes; ads move from order lines to the channel line, never both |
| 3 | Load **Missing refund** → Scenario → recovery ₹350 → ₹200 | O05 unknown (₹6,180 partial); recommendation goes from charge return shipping (₹150, confidence unknown) to raise recovery via inspection (₹480) |
| 4 | Ledger → **Unit economics** on the worked order | Net revenue ₹800, CM1 50%, CM2 41.25%, CM3 28.75%, each with its formula |

`GET /api/v1/checks` returns all four in one request with no login, with the working for each line. Every expected value is in `data/expected.json`; the changed-input drills are one click each on the Import screen (`data/negative_tests/`).

## What is where

| Path | Contents |
|---|---|
| `api/src/engine/` | Pure rules: validate (V1–V9), contribution (R1–R6, R8), reconcile (R3, R11), leaks (R10), ledger, scenario and recommendation (R12, R13); `pulse.ts` for the owner analytics |
| `api/src/schema/orders.ts` | Zod schema v3.2 + labelled extensions and the column-alias table |
| `api/src/routes/` | Express routes, including Pulse and sign-in; contract in `docs/API.md`; error catalogue in `api/src/errors.ts` |
| `api/src/auth.ts` | Optional Cognito sign-in: token check and per-account scoping |
| `api/src/ai/` | Handlebars templates; optional Gemini adapter with guardrails, cache, quota guard and `AI_DISABLED` kill switch |
| `web/` | React + Vite. Landing page at `/` (`web/index.html`, `web/src/landing/`); app at `/app/` (`web/app/index.html`): Import → Ledger → Leaks → Scenario → Decision, plus Pulse. Brand in `web/src/brand.ts` |
| `data/C21/fixture.json` | Reference fixture from the pack, untouched |
| `data/C21_extended.json` | 20 reference rows + synthetic S01–S08 (`"synthetic": true`) |
| `data/demo_12m.json` | 3,020 synthetic orders, Oct 2025–Sep 2026, every row `"synthetic": true`; written by `scripts/gen-demo.mjs` with a fixed seed; used by Pulse, never by `/checks` |
| `data/negative_tests/` | duplicate order, late refund, null refund, missing fee, refund over gross, bad schema (CSV), recovery 400 |
| `data/expected.json` | Single source of expected values for tests and `make check` |
| `tests/` | Acceptance tests (Blueprint §18) |
| `scripts/check.mjs` | Check harness: `BASE_URL=… npm run check` |
| `scripts/ui-smoke.mjs` | UI smoke in a real browser: `WEB_URL=… npm run ui:smoke` |
| `infra/`, `.github/workflows/` | Docker, AWS scripts (S3, CloudFront, EC2, ECR, IAM, SSM, CloudWatch, domain, Cognito, CI OIDC), CI and deploy |
| `docs/` | `PRODUCT.md` (MVP, USPs, pitch), `MARKET.md` (similar products, what Profyn adds, go-to-market), `DEMO.md`, `RULES.md`, `API.md`, `DEPLOY.md`, `SNAPSHOT.md`, `FEEDBACK.md`, `adr/`, `mba/` |

## Data rules

- `null` means unknown, never zero. A missing nullable field is unknown; the order has no contribution value and totals are labelled partial.
- Net product cost is product cost less recovered cost, subtracted once.
- Ads are deducted per order (allocate) or once per channel as channel spend (= Σ allocated ads), never both.
- Handling is ₹0 unless a row supplies `handling_inr` (labelled estimate); ₹20 would break the pack's +420 per kept order.
- A refund dated after the period end is pending: the order counts as kept in the period and the recognised value is shown beside it.
- Attribution is allocation, not causation.
- Optional CSV columns `payment_type` (cod|prepaid), `customer_id` and `units` feed Pulse. Without them, the payment and repeat-customer views say the data is not in the file, and a missing `units` counts as 1.

## Sign-in (optional)

Sign-in uses Amazon Cognito and is off unless `COGNITO_POOL_ID`, `COGNITO_CLIENT_ID` and `COGNITO_DOMAIN` are all set for the API. When it is on, a Bearer id token scopes datasets, analyses and decisions to the account. A visitor without a token is a guest in the demo workspace, whose datasets and decisions are saved to the shared demo database. Nobody needs to sign in to run the demo or the checks.

## Contributors

| Member | Track | Component |
|---|---|---|
| M1 | 1 — Platform, engine, infrastructure | API, Zod schema, engine, Mongo models, decisions and export, /checks, Docker, CI, AWS |
| M2 | 2 — Interface | Five screens, tokens, ledger table, waterfall drawer, scenario controls, whale curve |
| M3 | 3 — Narrative, docs, handoff | Templates, Gemini adapter guardrails, DEMO, RULES, SNAPSHOT, FEEDBACK, ADRs, MBA CSVs |
| M4 | 4 — Data, tests, judge drills | Extended fixture, negative tests, expected.json, Vitest suites, check harness |
