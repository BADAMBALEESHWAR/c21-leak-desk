# Leak Desk (C21): order contribution and profit leak desk

Fynd × NMIMS case C21. A small D2C founder sees net sales, not contribution.
Leak Desk imports order economics, computes operational contribution per order with explicit refund and recovery semantics,
reconciles orders to channel and product totals under one attribution rule, finds the orders that lose money,
compares one controlled cost or refund scenario, and saves one measurable decision with its assumptions.
Every number comes from a deterministic, tested engine; template text (or, optionally, AI) only words it.

Operational contribution, not statutory net profit. The fixture and every added row are synthetic teaching data; no claim of live revenue or production readiness.

## MVP and USPs

**MVP: one journey, five steps.** Import order economics → Ledger with contribution per order that reconciles to channel and product totals → Leaks grouped by cause → Scenario with one controlled change → Decision with an assumption snapshot, 30-day test and stop rule.

**What makes it different**

1. Refund and recovery facts before any profit headline: the margin stays hidden until they are complete.
2. Every rupee is deterministic and auditable; AI only rewords text and is rejected if it adds a number.
3. Ads are never deducted twice: switch attribution and the totals stay reconciled.
4. Unknown is a value, never zero: partial totals and labelled assumptions.
5. One controlled change leads to one measurable decision.
6. Works from a CSV today (template and column aliases; 10,000 orders in about 0.3 s), with the same contract for Fynd order APIs tomorrow.
7. Judge-ready proof: `/checks`, the Pack checks panel, `make check` PASS ×3 and CI from a clean clone.

Details, proof for each claim and the pitch outline: `docs/PRODUCT.md`.

## Run it

```
docker compose up -d --build     # or: make up      → web http://localhost:3000, api http://localhost:8080
npm run check                    # or: make check   → PASS ×3
```

Without Docker (Node 20+; the API uses an in-memory store when `MONGO_URL` is empty):

```
npm run setup
npm run dev:api                  # http://localhost:8080/api/v1/health
npm run dev:web                  # http://localhost:5173
npm test                         # 133 Vitest tests: engine, reconcile, validate, scenario, api, ai-guard, fuzz, perf
npm run ui:smoke                 # clicks through the journey in Edge (needs dev:web running)
npm run check
```

## The three public checks

| # | Where | Expected |
|---|---|---|
| 1 | Ledger → **Worked order** | ₹230: revenue 1,000 − refund 200 − net product cost 400 − shipping 50 − ads 100 − handling 20 |
| 2 | Load the fixture or the extended sample → Ledger → switch attribution | Σ orders = Σ channels = Σ products: ₹6,000 on the fixture, ₹7,053 on the extended file, in both modes; ads move from order lines to the channel line, never both |
| 3 | Load **Missing refund** → Scenario → recovery ₹350 → ₹200 | O05 unknown (₹6,180 partial); recommendation goes from charge return shipping (₹150, confidence unknown) to raise recovery via inspection (₹480) |

`GET /api/v1/checks` returns all three in one request. Every expected value is in `data/expected.json`; the judge's changed-input drills are one click each on the Import screen (`data/negative_tests/`).

## What is where

| Path | Contents |
|---|---|
| `api/src/engine/` | Pure rules: validate (V1–V9), contribution (R1–R6, R8), reconcile (R3, R11), leaks (R10), ledger, scenario and recommendation (R12, R13) |
| `api/src/schema/orders.ts` | Zod schema v3.2 + labelled extensions and the column-alias table |
| `api/src/routes/` | Express routes; contract in `docs/API.md`; error catalogue in `api/src/errors.ts` |
| `api/src/ai/` | Handlebars templates; optional Gemini adapter with guardrails, cache, quota guard and `AI_DISABLED` kill switch |
| `web/` | React + Vite: Import → Ledger → Leaks → Scenario → Decision |
| `data/C21/fixture.json` | Reference fixture from the pack, untouched |
| `data/C21_extended.json` | 20 reference rows + synthetic S01–S08 (`"synthetic": true`) |
| `data/negative_tests/` | duplicate order, late refund, null refund, missing fee, refund over gross, bad schema (CSV), recovery 400 |
| `data/expected.json` | Single source of expected values for tests and `make check` |
| `tests/` | Acceptance tests (Blueprint §18) |
| `scripts/check.mjs` | Check harness: `BASE_URL=… npm run check` |
| `infra/`, `.github/workflows/` | Docker, AWS scripts (S3, CloudFront, EC2, ECR, IAM, SSM, CloudWatch), CI and deploy |
| `docs/` | `PRODUCT.md` (MVP, USPs, pitch), `DEMO.md`, `RULES.md`, `API.md`, `DEPLOY.md`, `SNAPSHOT.md`, `FEEDBACK.md`, `adr/`, `mba/` |

## Data rules

- `null` means unknown, never zero. A missing nullable field is unknown; the order has no contribution value and totals are labelled partial.
- Net product cost is product cost less recovered cost, subtracted once.
- Ads are deducted per order (allocate) or once per channel as channel spend (= Σ allocated ads), never both.
- Handling is ₹0 unless a row supplies `handling_inr` (labelled estimate); ₹20 would break the pack's +420 per kept order.
- A refund dated after the period end is pending: the order counts as kept in the period and the recognised value is shown beside it.
- Attribution is allocation, not causation.

## Contributors

| Member | Track | Component |
|---|---|---|
| M1 | 1 — Platform, engine, infrastructure | API, Zod schema, engine, Mongo models, decisions and export, /checks, Docker, CI, AWS |
| M2 | 2 — Interface | Five screens, tokens, ledger table, waterfall drawer, scenario controls, whale curve |
| M3 | 3 — Narrative, docs, handoff | Templates, Gemini adapter guardrails, DEMO, RULES, SNAPSHOT, FEEDBACK, ADRs, MBA CSVs |
| M4 | 4 — Data, tests, judge drills | Extended fixture, negative tests, expected.json, Vitest suites, check harness |
