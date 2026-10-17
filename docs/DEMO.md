# Demo script and judge sheet

Seven minutes: four to present, three for questions. Every number below is computed by the engine from `data/C21/fixture.json`, `data/C21_extended.json` or `data/negative_tests/`, and the totals are fixed in `data/expected.json`. The rules behind them are in `docs/RULES.md`.

Web: http://localhost:5173 (Node dev) or http://localhost:3000 (Docker Compose). API: http://localhost:8080/api/v1.

## Before the slot

1. `npm run check` (or `make check`) prints `PASS` three times.
2. `AI_DISABLED=1` (the default). `/api/v1/health` shows `"ai":"disabled"`.
3. Open these tabs in order. Each link loads a sample and opens the right view by itself.
   - Tab 1: `http://localhost:5173/#/ledger?load=fixture&worked=1` (worked order drawer)
   - Tab 2: `http://localhost:5173/#/import` (to load the extended file and show the flag report)
   - Tab 3: `http://localhost:5173/#/scenario?load=null_refund` (check 3)
   - Tab 4: the "before" screenshot of the Ledger strip for the headline gate (`docs/FEEDBACK.md`)
   - Terminal: repository root, ready to run `npm run check`
4. Phone: the CloudFront URL, if the AWS deploy is live. If not, skip that line in the close.

Suggested roles: M3 speaks, M2 drives the screen, M1 and M4 hold the terminal and the drill files.

## The 4-minute script

| Time | Beat | Click | Say or point to |
|---|---|---|---|
| 0:00 | Opening | Tab 1, drawer closed | "A small D2C founder sees net sales, not contribution. Leak Desk finds the orders that lose money, puts refund and recovery facts before any headline, and saves one measurable decision. Every number is deterministic; AI only words it." |
| 0:25 | Check 1 | Tab 1: Ledger → **Worked order** | Six lines: revenue 1,000; refund −200; net product cost −400; shipping −50; ads −100; handling −20 = **₹230**. Point to the note: "Net product cost is after any recovered stock cost; recovery is not subtracted a second time." |
| 0:55 | Journey | Tab 2: Import → **Load fixture + synthetic rows** | Flag report: **duplicate S05** (a second S01, dropped), **late refund S06** (refund dated 2026-10-05, after the 2026-09-30 period end), **unknown S04** (refund, recovery and return cost missing). Synthetic rows are labelled. **Continue to ledger** → contribution **₹7,053, partial (1 unknown)**; 1 late refund pending, **−₹600** if recognised. |
| 1:30 | Check 2 | Ledger: reconciliation line, **By channel** tab, then top bar → **Channel spend** | "Σ orders = Σ channels = Σ products ✓" at ₹7,053. Channels: web 1,279, marketplace 254, instagram −480, unassigned 6,000. After the switch, the order rows read "to channel" for ads, the channel lines carry spend web 250, marketplace 100, instagram 140 (₹490), and every channel total and the ₹7,053 stay the same. Say "never both". |
| 2:00 | Check 3 | Orders tab → click **S04**; then Tab 3 | S04: unknown chip, no contribution value. Tab 3 loads the printed check-3 file (O05 refund null): ledger **₹6,180 partial (1 unknown)**. Scenario baseline: **charge_return_shipping ₹150, confidence unknown**. Set recovery to ₹200 per return (50%) → **Run scenario** → total **₹5,730**, recommendation flips to **raise_recovery_via_inspection ₹480**, confidence unknown. Go to Decision → enter an owner → **Save decision** (the assumption snapshot and 30-day test are filled in) → **Export Markdown**. |
| 2:45 | Deliberate failure | Import → Judge drills → **Load missing payment fee** | Payment fee removed from every row: **20 of 20 orders unknown**, contribution unknown and labelled partial, no error page. Then Leaks or Scenario: every explanation carries the **template** tag because `AI_DISABLED=1`; nothing else changes. |
| 3:15 | Business feedback | Tab 4 (before), then Ledger on the fixture and on the extended file (after) | The headline gate. Before: contribution % shown while S04's refund was unknown. After: fixture shows **41.7%** (facts complete); extended shows **hidden** with "Contribution % is hidden until refund and recovery facts are complete (1 order unknown)". This is the case's product change: refund and recovery semantics before a profit headline. |
| 3:40 | Handoff | Terminal | `git clone … && make up && make check` → PASS ×3 (or `npm run check` on this laptop). CloudFront URL on the phone if live. `docs/SNAPSHOT.md` and `docs/mba/Venture_Brief.csv` for the MBA team. Close: "Operational contribution, not statutory profit." |
| 4:00–7:00 | Questions | — | Each member answers for their own track. Prepared answers below. |

If the Scenario screen is slow, use the API instead of the screen for check 3: `GET /api/v1/checks` returns the same values.

## The three checks, in printed order

### Check 1: reference order = ₹230

| Item | Expected |
|---|---|
| Where | Ledger → **Worked order** (or Tab 1). API: `GET /api/v1/worked-order`, `GET /api/v1/checks` → `check1` |
| Lines | Revenue 1,000; refund −200; net product cost −400; shipping −50; ads −100; handling −20 |
| Result | **₹230** (expected 230, matches) |
| Note on screen | Net product cost is after recovery; not subtracted twice |

### Check 2: totals reconcile; ads and channel spend never both deducted

| Item | Expected |
|---|---|
| Where | Import → Load C21 fixture (or the extended sample) → Ledger → reconciliation line; **By channel** and **By product** tabs; Attribution radio |
| Fixture | 16 kept orders at **+420**, O05, O10, O15, O20 at **−180**; gross ₹20,000, net sales ₹14,400, contribution **₹6,000**; Σ orders = Σ channels = Σ products = ₹6,000 in both modes |
| Extended, allocate | **₹7,053** partial (1 unknown). Channels: web 1,279 · marketplace 254 · instagram −480 · unassigned 6,000. Products: P1 680 · P2 438 · P3 −65 · unassigned 6,000 |
| Extended, channel | **₹7,053**. Channel spend web 250 · marketplace 100 · instagram 140 (₹490). Products "before channel spend": P1 780 · P2 598 · P3 165 · unassigned 6,000 |
| Never both | Allocate mode plus explicit channel spend → **409** `attribution_conflict` with the rule text |

### Check 3: missing refund facts are unknown; changing the return assumption changes the recommendation

| Item | Expected |
|---|---|
| Where | Import → Judge drills → **Load missing refund** (or Tab 3) → Ledger → Scenario |
| Unknown | O05 status unknown, no contribution value; total **₹6,180 partial (1 unknown)**; contribution % hidden |
| Baseline recommendation | **charge_return_shipping, ₹150, confidence unknown** |
| Recovery 50% (₹350 → ₹200 per return) | Scenario total **₹5,730**; recommendation **raise_recovery_via_inspection, ₹480**, confidence unknown |
| Return rate 30% | Scenario total **₹4,980**; charge_return_shipping **₹250** (the expected rupees change) |
| assume_unknown_refund | O05 refund assumed 900 → total ₹6,000, labelled assumption, confidence low |
| On the clean fixture, for comparison | Baseline charge_return_shipping ₹200 (low, 4 returns); recovery 50% → raise_recovery_via_inspection ₹640 (low); return rate 30% → ₹4,800, charge_return_shipping ₹300 (high, 6 returns) |

## Changed-input drills

The judge changes one input and keeps the rule. Write the expected result on the sheet before running it. Load each file from Import → Judge drills, or drop it from `data/negative_tests/` on the drop zone.

| Drill | File | Expected on screen | Rule |
|---|---|---|---|
| Duplicate order | `duplicate_order.json` (O07 twice) | 20 orders, 1 flag "O07 appears again … second occurrence dropped", total ₹6,000 | R7, V5 |
| Late refund | `late_refund.json` (O10 refund_date 2026-10-05) | O10 at +420 in the period, flagged late; −180 if recognised; total **₹6,600**; "1 late refund pending, −₹600 if recognised" | R8, V6 |
| Late refund, period end moved | `late_refund.json` with Period as-of date 2026-10-31 | The refund now falls inside the period: O10 −180, total ₹6,000, nothing pending | R8 |
| Missing refund | `null_refund.json` (O05 refund null) | O05 unknown; **₹6,180** partial (1 unknown); confidence unknown | R6, V7 |
| Missing payment fee | `missing_fee.json` (fee removed from every row) | **20 unknown**; contribution unknown, partial; no crash | R6, V7 |
| Refund over gross | `refund_over_gross.json` (O03 refund 1,500) | O03 excluded and listed as invalid; **19 orders, ₹5,580** | V2 |
| Full recovery | `recovery_400.json` (recovered 400 on returns) | Returned orders at **−130**; total **₹6,200** | R2, R9 |
| Bad schema | `bad_schema.csv` (no `product_cost_inr` column) | **422** shown inline with the field path `product_cost_inr`; nothing imported | V1 |
| Scenario: return rate | Fixture → Scenario → return rate 30% | ₹6,000 → **₹4,800**; charge_return_shipping ₹300, confidence high | R12, R13 |

## Deliberate-failure beats

| Failure | How to trigger | What the judge sees |
|---|---|---|
| Missing fact on every row (on stage) | Load `missing_fee.json` | 20 unknown, partial total, no error page |
| AI off (on stage) | `AI_DISABLED=1` (default) | Template tag on every explanation; `/health` `ai: "disabled"`; numbers identical |
| Bad file (reserve) | Drop `bad_schema.csv` | 422 inline with the field path; the previous ledger is untouched |
| Database down (reserve, Docker only) | `docker compose stop mongo` | `/health` 503 `status: "degraded"`; the ledger still computes and shows "Not saved to the database — results are in memory only."; **Save decision** shows a clear error. `docker compose start mongo` to recover |
| API down (reserve) | Stop the API process | The web app shows "The API is not reachable at /api/v1" and checks again every few seconds |

## Question drill (3 minutes)

Each member answers for their own track in under 30 seconds.

| Question | Who | Prepared answer |
|---|---|---|
| What does "net of recovery" mean? | M1 | Net product cost is product cost minus the stock value recovered after a return, subtracted once. O05: 400 − 350 = 50, so the return costs −180. The worked order already gives net product cost 400, so recovery is not subtracted again. |
| What happens to a duplicate order? | M4 | The first row is kept; later rows with the same order_id are excluded and listed with line and reason. O07 twice still gives 20 orders and ₹6,000. In the extended file, row S05 repeats S01 and is dropped. |
| How do you treat a late refund? | M4 | A refund dated after the period end does not change that period. S06 counts as kept at +350; the recognised value −250 is shown beside it, and the ledger says "1 late refund pending, −₹600 if recognised". Moving the period end recognises it. |
| Why is attribution not causal? | M2 | We book ad spend to orders or channels by a rule. That says where the cost sits, not that the ad produced the order. Both modes give ₹7,053, and every attribution view says "attribution is allocation, not causation". |
| What may AI not do? | M3 | Compute or change a number, rank or choose the recommendation, classify leaks, invent order IDs, or claim that ads caused sales. It may only reword template text; any rupee figure not in the input discards the rewrite. It is off by default. |
| How does rollback work? | M1 | Images are tagged with the commit SHA. Rollback retags the previous SHA as latest and re-runs `docker compose pull && docker compose up -d` on the instance; the web build keeps earlier releases in S3. Locally, check out the previous tag and run `make up`. Steps are in `docs/DEPLOY.md`. |

Reserve questions:

| Question | Who | Prepared answer |
|---|---|---|
| Why is handling ₹0 on the fixture? | M1 | The fixture has no handling column. A ₹20 default would make kept orders 400 and the total ₹5,600, contradicting the pack's +420. The default is ₹0 and labelled an estimate; rows that carry handling use it. |
| Why hide contribution %? | M3 | A percentage over known orders only looks complete when it is not. Until every refund and recovery fact is in, the headline stays hidden and says why. |
| What does the MBA team inherit? | M3 | A working five-screen journey, engine 1.0.0 with tested values, the snapshot (tests, gaps, backlog), and pre-filled Venture Brief, Unit Economics and Growth Plan with every business number marked as an assumption to test. |
| What if a judge adds a row with no channel? | M4 | It goes to `unassigned`, and reconciliation still balances. If a total ever differs, the rupee gap is shown in red rather than hidden. |
