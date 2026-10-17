# Leak Desk: product, MVP and USPs

Case C21, Fynd × NMIMS. Operational contribution, not statutory net profit. All data is the pack's teaching fixture plus labelled synthetic rows; nothing here claims live revenue or production readiness.

## The problem

A small D2C founder sees net sales grow while cash does not. Month-end arrives and nobody can say which orders lost money, or whether returns, discounts, shipping or ads caused it. Their spreadsheet subtracts refunds inconsistently, counts recovered stock twice or not at all, and deducts ads both per order and per channel. Any "profit" headline built on that is wrong in a way the founder cannot see.

## Who it is for

| Role | Need |
|---|---|
| Founder-operator (100–2,000 orders a month, no finance team) — the user and the payer | Which orders lose money, why, and the one rule to change this month |
| Whoever owns returns, discounts and shipping charges | A change they can test for 30 days with a stop rule |
| A finance reviewer | Numbers that reconcile and can be re-run |

## MVP: the five-step journey

Each step answers one line of the problem statement; every number comes from the deterministic engine.

| Step | What the founder does | Problem-statement line | See it |
|---|---|---|---|
| 1. Import | Loads the C21 fixture or drops a JSON/CSV in the same schema; sees what was kept, flagged or rejected and why | "Import order economics"; data validation; CSV or JSON handling | Import screen; `GET /api/v1/template.csv` |
| 2. Ledger | Sees contribution per order with every deduction labelled, and totals by channel and product that reconcile | "Reconcile per-order contribution to channel/product totals" | Ledger screen; KPI cards open the period waterfall |
| 3. Leaks | Sees losing orders grouped by cause with ₹ lost | "Locate negative-contribution orders" | Leaks screen |
| 4. Scenario | Changes one assumption and sees the recommendation move | "Compare a controlled cost/refund scenario" | Scenario screen |
| 5. Decision | Saves one intervention with its assumptions, expected ₹, 30-day test and stop rule; exports it | "Save the decision"; readable evidence and a saved result | Decision screen; Markdown/JSON export |

## What makes it different (USPs)

| # | USP | Why it matters to a founder | Proof in the product |
|---|---|---|---|
| 1 | **Refund and recovery facts before any profit headline** | A margin shown over incomplete refund facts misleads; this is the case's product change | Ledger Margin card stays locked ("Hidden until refund facts are complete") while any return lacks a refund or recovery fact; `totals.headline_ready` |
| 2 | **Every rupee is deterministic and auditable; AI only words it** | A founder (and their CA) can check every figure; the model cannot invent one | Pure TypeScript engine with 133 tests; AI text is rejected if it contains any number not in the input, uses banned words or breaks the schema; "template"/"AI" tag on every sentence; `AI_DISABLED=1` runs the whole demo |
| 3 | **Ads are never deducted twice** | Per-order ad allocation and channel spend are the same money | Attribution toggle: ads move from order lines to the channel line while Σ orders = Σ channels = Σ products stays ₹7,053; supplying both is refused with 409 |
| 4 | **Unknown is a value, never zero** | A missing refund silently treated as 0 inflates contribution | Unknown chips, partial totals, recommendation confidence "unknown"; any filled gap is a stated, labelled assumption |
| 5 | **One controlled change → one measurable decision** | Founders need one rule to try, not a dashboard | Scenario allows exactly one change; four candidate rules ranked by ₹; the decision stores the assumption snapshot, engine version, 30-day test and stop rule |
| 6 | **Works from a CSV today, Fynd order APIs tomorrow** | No connector project before the first value | Fixed C21 schema with a column-alias table (cogs, sku, gateway_fee…); downloadable template; 10,000 orders analysed in about 0.3 s |
| 7 | **Judge-ready proof** | Trust is earned with checks, not claims | `GET /api/v1/checks`, the Pack checks panel with "Show me" links, `make check` (PASS ×3), CI that rebuilds from a clean clone |

## Value for Fynd

- **Brands served:** Fynd's omnichannel brands run marketplace and D2C orders daily; a per-order contribution view is the margin layer revenue dashboards lack.
- **Data advantage:** Fynd already holds order, freight, payment and return data; the desk needs no new connector, only the same schema.
- **New product line:** a "Profit Desk" module inside Fynd's commerce suite, priced per brand per month (the MBA team's subscription hypothesis, see `docs/mba/`).
- **Operational:** typed leaks (partial recovery, discount deeper than margin, fees above margin) point at policies Fynd's fulfilment and payments teams can act on.

## The numbers a judge can check

| Item | Value | Where |
|---|---|---|
| Worked order (check 1) | ₹230: 1,000 − 200 − 400 − 50 − 100 − 20 | Ledger → Worked order |
| Fixture | 16 kept orders × +420, 4 returns × −180 = ₹6,000 | Load C21 fixture |
| Extended file (check 2) | ₹7,053 in both attribution modes; channel spend 250 / 100 / 140 | Load fixture + synthetic rows → switch attribution |
| Missing refund (check 3) | O05 unknown; recovery ₹350 → ₹200 flips "charge return shipping ₹150" to "raise recovery via inspection ₹480" | Load missing refund → Scenario |
| Scale | 10,000 orders: validate 83 ms, analyse 214 ms | `tests/perf.test.ts` |
| Robustness | 50 random judge-style edits: never a 5xx, always reconciled | `tests/fuzz.test.ts` |

## Out of scope (said on the slide)

Live store connectors, statutory P&L or GST, causal attribution of advertising, forecasting, multi-currency, multi-tenant accounts and authentication.

## Pitch outline (4 minutes, 5 slides)

1. **The leak (0:00–0:25).** Net sales are not contribution. One sentence on the founder's month-end, then the opening line from `docs/DEMO.md`.
2. **Proof first (0:25–2:00).** Live: worked order ₹230 → load the extended file → reconciled ₹7,053 → toggle attribution, "never both" → missing refund → recovery ₹200 flips the recommendation → save the decision.
3. **Why trust it (2:00–2:45).** Deterministic engine, unknown never zero, AI only words it; deliberate failure: missing fee file, no crash.
4. **What changed after feedback (2:45–3:15).** The headline gate, and the interface redesign with clickable KPI drill-downs (`docs/FEEDBACK.md`).
5. **Handoff and what's next (3:15–4:00).** One-command run, PASS ×3, CI green; the MBA team's subscription test and 30-day growth plan; close on "operational contribution, not statutory profit".
