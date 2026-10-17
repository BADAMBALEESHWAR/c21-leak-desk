# MBA-entry snapshot

Case C21, Order Contribution and Profit Leak Desk. Engine 1.0.0.

The case's snapshot rule: "At MBA entry, save a demo or screen recording, current tests, known gaps, backlog and contributor list. Record the business team's joining time and baseline." Each item is a section below.

Snapshot taken: 2026-10-17 18:42 (laptop local time), on the Node path. **Before the business team joins, re-run sections 3 and 4 and paste the output if anything changed.**

## 1. Recording

- Demo recording (the 4-minute script in `docs/DEMO.md`): `[link to fill]`
- Recorded by and when: `[to fill]`
- Build shown in the recording (engine version from `/api/v1/health`, and tag or commit): `[to fill]`

## 2. How to run

Without Docker, Node 20 or later, three commands from the repository root:

```
npm run setup        # installs root, api and web dependencies
npm run dev:api      # terminal 1: API on http://localhost:8080
npm run dev:web      # terminal 2: web on http://localhost:5173
```

Then, in a third terminal: `npm test` (all suites) and `npm run check` (the three public checks against the running API, PASS ×3).

With Docker: `make up` (web on http://localhost:3000, API on http://localhost:8080, Mongo inside Compose), then `make check`.

Without `MONGO_URL` the API keeps data in memory: `/health` shows `"db":"memory"` and saved decisions are lost on restart. AI rewording is off (`AI_DISABLED=1`); every explanation is template text.

## 3. Test results

Command: `npm test` from the repository root (Vitest 2.1). Run at 2026-10-17 18:42:

```
 ✓ tests/scenario.test.ts (9 tests) 67ms
 ✓ tests/engine.test.ts (14 tests) 30ms
 ✓ tests/reconcile.test.ts (10 tests) 92ms
 ✓ tests/validate.test.ts (14 tests) 72ms
 ✓ tests/ai-guard.test.ts (9 tests) 9ms
 ✓ tests/api.test.ts (17 tests) 344ms
 Test Files  6 passed (6)
      Tests  73 passed (73)
   Duration  2.38s (transform 648ms, setup 0ms, collect 3.85s, tests 614ms, environment 2ms, prepare 1.20s)
```

History of this snapshot, kept so the baseline is honest:

- 18:27, before the engine was aligned with `data/expected.json`: `Tests  6 failed | 32 passed (38)`. The six asserted draft values (late refund on O05, payment fee missing on one row, ₹600 of channel spend) that `data/expected.json` has since replaced.
- 18:37, during the engine rewrite: `Test Files  5 failed (5)`, `Tests  22 failed | 16 passed (38)`. The tests had not yet been moved to the new function signatures.
- 18:42: all 73 pass (above).

- 20:00, after the fuzz suite, the AI retry and the CSV header guard (127 tests):

```
 ✓ tests/engine.test.ts (14 tests) 24ms
 ✓ tests/scenario.test.ts (9 tests) 62ms
 ✓ tests/reconcile.test.ts (12 tests) 77ms
 ✓ tests/validate.test.ts (14 tests) 59ms
 ✓ tests/ai-guard.test.ts (10 tests) 12ms
 ✓ tests/api.test.ts (18 tests) 194ms
 ✓ tests/fuzz.test.ts (50 tests) 646ms
 Test Files  7 passed (7)
      Tests  127 passed (127)
```

  The fuzz suite (50 seeded random edits to the fixture) found one real defect on its first run: an order with `ads_inr: null` stayed computed in channel mode and left that channel's spend unknown, so reconciliation failed. Unknown ads now make the order unknown in both modes; the case is pinned in `tests/reconcile.test.ts`.

UI smoke (`npm run ui:smoke`, Edge driving the real app at 20:00): 7 of 7 steps pass — load fixture, ₹ 6,000 reconciled, worked order ₹ 230, O05 drawer −₹ 180, channel mode still reconciled, check 3 flip ₹ 150 → ₹ 480, decision saved.

- 21:20, after the product additions (CSV template, ledger export, editable handling estimate, 10,000-order performance test): `Tests  134 passed (134)` across 8 files; the full Docker stack (nginx, API, MongoDB) then passed `make check` PASS ×3 and the 8-step UI smoke. On this laptop 10,000 orders validate in 83 ms and analyse in 214 ms (Blueprint target: 2 s); a 3.1 MB upload of 10,000 orders is accepted and analysed through the API.

Re-run before the business team joins and paste the result here if anything changed: `[time and summary lines]`

## 4. Check harness output

`/api/v1/health` at 18:42 (Node path, no `MONGO_URL`):

```
{"status":"ok","db":"memory","ai":"disabled","storage":"local","engine_version":"1.0.0","uptime_s":372}
```

`npm run check` at 18:42, against http://localhost:8080:

```
check1  worked order contribution                   expected 230   actual 230                                 PASS
check2  Σorders=Σchannels=Σproducts (both modes)    7053 = 7053 (never both: true)                            PASS
check3  unknown labelled; recommendation changes    charge_return_shipping → raise_recovery_via_inspection    PASS
engine 1.0.0 · 3/3 passed in 0.1 s · http://localhost:8080
```

Behind check 3, `GET /api/v1/checks` returned charge_return_shipping ₹150 before and raise_recovery_via_inspection ₹480 at recovery 50%, with confidence unknown, matching `docs/DEMO.md`.

Docker Compose stack (api + MongoDB 7), run on this laptop on 2026-10-17 with `API_PORT=8090 docker compose up -d --build api mongo`:

```
{"status":"ok","db":"ok","ai":"disabled","storage":"local","engine_version":"1.0.0"} 200
check1  worked order contribution                   expected 230   actual 230                                 PASS
check2  Σorders=Σchannels=Σproducts (both modes)    7053 = 7053 (never both: true)                            PASS
check3  unknown labelled; recommendation changes    charge_return_shipping → raise_recovery_via_inspection    PASS
```

In the same run, a decision saved to Mongo survived an API container restart. With Mongo stopped, `/health` returned 503 `degraded` and a new import returned `persisted: false`.

Not yet captured: `make check BASE_URL=<CloudFront URL>` against AWS: `[paste when run]`

## 5. Known gaps

Stated plainly so the business team does not inherit surprises.

1. **Tests went green only minutes before the snapshot** (section 3 history). Nothing has been run on a second machine yet.
2. **Docker path verified on this laptop, not yet from a clean clone on a second machine.** The full stack (web via nginx, api, MongoDB 7) ran with `API_PORT=8090 WEB_PORT=3010 docker compose up -d --build`; `BASE_URL=http://localhost:3010 npm run check` printed PASS ×3 through the nginx `/api` proxy.
3. **AWS not deployed.** No CloudFront URL yet. The scripts in `infra/` (`aws-up.sh`, `deploy-api.sh`, `deploy-web.sh`, `aws-down.sh`) and `.github/workflows/deploy.yml` exist but have not been run. `docs/DEPLOY.md` is the plan.
4. **AI rewording is optional and off by default** (`AI_DISABLED=1`). The adapter (`api/src/ai/client.ts`) passes its stubbed guard tests (`tests/ai-guard.test.ts`) but has not been run with a live key. With AI off, every explanation is template text and labelled so.
5. **Tailwind and shadcn/ui are not used.** The web app uses plain CSS with the same design tokens (`web/src/styles/tokens.css`). Recharts is not used.
6. **Money is in whole rupees.** Paise are not modelled. Half-up rounding of decimal inputs at import, with a flag (Blueprint §11), is not verified.
7. **In-memory store when `MONGO_URL` is empty.** Decisions do not survive a restart in that mode; the UI says so.
8. **UI smoke runs on Edge locally; CI uses Chromium.** `npm run ui:smoke` (playwright-core) clicks load → worked order → drawer → mode → scenario → decision; the CI `verify` job has not run yet because the repository is not on GitHub.
9. **Handling default is ₹0, not the Blueprint's ₹20**, so the fixture keeps its +420 per kept order. Rows that carry handling use it. See R4 in `docs/RULES.md`.
10. **Synthetic data only.** The fixture is a 20-order teaching file and S01–S08 are labelled synthetic rows. Nothing here is evidence about real founders, real prices or real demand.
11. **Out of scope by design:** live store or marketplace connectors, statutory P&L, GST and tax, causal ad attribution, forecasting, multiple currencies, multiple tenants, login.

## 6. Backlog, in priority order

| # | Item | Why | Owner |
|---|---|---|---|
| 1 | Cold run on a second laptop by someone who did not build the feature: `npm run setup`, `npm test`, `npm run check`, then the drills in `docs/DEMO.md` | The suite went green only at snapshot time | M4 |
| 2 | Run `make up` → `make check` on a clean clone on a second laptop | Reproducibility is scored | M4 |
| 3 | Record the 4-minute demo and link it in section 1 | Snapshot rule | M3 |
| 4 | Mentor round: record notes verbatim in `docs/FEEDBACK.md`; confirm or replace the headline-gate change | Business-feedback criterion | All |
| 5 | AWS deploy per `docs/DEPLOY.md`; run `make check BASE_URL=<CloudFront URL>` | Organiser requirement; second screen | M1 |
| 6 | Done: UI smoke test of the journey (`scripts/ui-smoke.mjs`); extend it to the Leaks screen and the judge drills | Catches wiring breaks the unit tests miss | M2, M4 |
| 7 | Run the AI rewording adapter with a live key; confirm the number-grounding guard, the 6-second fallback and the template tag on screen | Optional; labelled; off by default | M3 |
| 8 | Decimal amounts: round half-up at import and flag when rounding exceeds ₹0.5 | Real exports carry paise | M1 |
| 9 | Column mapping for common store and marketplace order exports | Needed for the sample order audit with real founders | M1, MBA team |
| 10 | Month-over-month view of contribution and leaks | The subscription is a monthly report | M2, MBA team |

## 7. Contributors

Names to be filled by the team. Each member can explain and defend their own component.

| Member | Name | Track | Component |
|---|---|---|---|
| M1 | `[to fill]` | Track 1 | API, Zod schema, engine (contribution, validate, reconcile, leaks, scenario, recommendation), persistence, decisions and export, `/checks`, `/health`, Docker, CI, AWS |
| M2 | `[to fill]` | Track 2 | Web app: five screens, design tokens, ledger table, waterfall drawer, reconciliation line, scenario controls, decision form, all states |
| M3 | `[to fill]` | Track 3 | Narrative templates, optional AI rewording, `docs/DEMO.md`, `docs/RULES.md`, `docs/SNAPSHOT.md`, `docs/FEEDBACK.md`, `docs/adr/`, recording, `docs/mba/` |
| M4 | `[to fill]` | Track 4 | Extended file, negative-test files, `data/expected.json`, Vitest suites, check harness, judge drills, cold runs |

## 8. Baseline for the MBA team

The MBA comparison is baseline to final: what you inherit, what you decide, and what changes. This is the baseline.

What works:

- A five-screen journey, Import → Ledger → Leaks → Scenario → Decision, running locally.
- Import of JSON or CSV in the C21 schema with a flag report (duplicate, late refund, unknown, invalid).
- Per-order contribution with refund and recovery netted once; totals by channel and product that reconcile in both attribution modes.
- Leak groups by cause; a controlled one-change scenario; a recommendation with a confidence label; a saved decision with its assumption snapshot, 30-day test and stop rule, exported as Markdown or JSON.
- The headline gate: no contribution % until refund and recovery facts are complete.

Numbers you inherit (all from the synthetic teaching fixture):

| Item | Value |
|---|---|
| Contribution per kept order | ₹420 (net sales ₹900) |
| Contribution per returned order | −₹180 |
| Blended contribution per order at a 20% return rate | ₹300 (₹6,000 / 20) |
| Blended at a 30% return rate | ₹240 (₹4,800 / 20) |
| Recommendation on the fixture | Charge return shipping, ₹200, confidence low (4 returns) |

What is not proven: whether founders have this problem badly enough to pay, what they would pay, whether they will share order-level refund and recovery data, and whether a report built on their real exports matches their finance-approved figures. The pre-filled templates in `docs/mba/` mark every business number as an assumption to test; change them as you learn.

Files to start from: `docs/mba/Venture_Brief.csv`, `docs/mba/Unit_Economics.csv`, `docs/mba/Growth_Plan.csv`, `docs/DEMO.md` (to run the product yourselves), `docs/FEEDBACK.md` (the negotiated product change).

## 9. Business team joining

| Item | Value |
|---|---|
| Joining time | `[YYYY-MM-DD hh:mm, to fill at MBA entry]` |
| MBA team ID | `[to fill]` |
| Members | `[to fill]` |
| Baseline build at joining (tag or commit, engine version) | `[to fill]` |
| Handoff walkthrough given by | `[to fill]` |
