# Business feedback and the change we made

Hour 10–12 is the mentor round (all four members, about 20 minutes). We record what mentors say word for word, choose one change, build it, and show the before and after in the demo. This file is the evidence for the "improvement after business feedback" criterion.

## Change log: from the brief to the evidence

The story in three parts: where the ledger started, what scope we negotiated, and the evidence that it now holds. The app's Change log page (`#/changelog`) renders this section and `docs/SCOPE.md` as they are, so the app and the docs cannot drift.

### 1. Starting state

Before refund semantics, a return was read the simple way:

- **A refund was treated as lost revenue.** The order was booked as a sale that went away, and its full product cost stayed in.
- **Recovery was ignored.** Stock value that came back on a return was never subtracted from product cost, so every return looked worse than it was, and "recover more on returns" could never show up as a fix.

On fixture order O05 (gross 1,000, discount 100, refund 900, product cost 400, recovered 350, shipping 60, fee 20, return cost 50), ignoring recovery gives 0 − 400 − 60 − 20 − 50 = **−₹530**. With recovery subtracted once it is 0 − 50 − 60 − 20 − 50 = **−₹180**.

### 2. Negotiated scope

What we agreed to build so that every number can be checked, and what we cut.

**Included**

- **Net revenue = revenue − refund** (rule R1). A refund reduces revenue; it is not a second loss on top.
- **Net product cost = product cost − recovered** (rule R2). Recovery is subtracted once, never twice, and never added back as revenue.
- **Payment fee is deducted separately**, on its own line, not folded into shipping or product cost.
- **A late refund is a prior-period adjustment** (rule R8). A refund dated after the period end leaves the reported month as it was; the ledger shows the adjustment and the restated total beside it.

**Cut**

- **Causal attribution** of advertising. Ads are allocated per order or deducted per channel, never both: allocation, not causation.
- **Statutory profit.** Profyn reports operational contribution, not net profit for filing (no P&L, GST or tax).
- **Connectors** for Shopify, Meta Ads, Google Ads, Shiprocket and Razorpay. Orders arrive as CSV or JSON exports instead.

The full table of what works now and what is planned is in `docs/SCOPE.md`.

### 3. Final evidence

- **[Checks page](#/checks):** every check re-runs the engine on the reference data and shows its working, live. `GET /api/v1/checks` returns the same results as JSON, with no login.
- **Check 1: ₹230.** The worked order: 1,000 − 200 − 400 − 50 − 100 − 20, six lines with a running total.
- **Check 2: ₹7,053 in both modes.** On the extended sample Σ orders = Σ channels = Σ products = ₹7,053 with ads allocated per order and with channel spend (₹6,000 on the fixture); difference ₹0. Deducting ads in both modes is refused with AttributionConflict (409).
- **Check 3: the label changes.** O05's refund is missing, so it stays "Unknown" and the total reads "partial (1 unknown)". Assume a return rate and the result is relabelled "Scenario: assumes X% returns", re-run on that stated assumption: at 0–2% returns the recommendation changes from "Charge return shipping" to "No change"; at other rates only its amount moves. With recovery at 50% instead, it changes from "Charge return shipping" (₹150) to "Raise recovery via inspection" (₹480).
- **Check 4: margins on the worked order.** Net revenue ₹800, gross margin 50%, CM2 41.25%, contribution margin 28.75%, each with its formula.
- **Tests:** 247 automated tests in 20 files pass, and the browser smoke test passes 12 of 12 steps.

## 1. Mentor notes, verbatim

Write the words as they were said. Do not summarise in the "Verbatim" column; put our reading in the next column. One row per point.

| # | Time | Mentor (name, role) | Verbatim | Our reading | Track |
|---|---|---|---|---|---|
| 1 | hh:mm | | "" | | |
| 2 | hh:mm | | "" | | |
| 3 | hh:mm | | "" | | |
| 4 | hh:mm | | "" | | |
| 5 | hh:mm | | "" | | |

Recorded by: M3. Checked by: one other member, before the change is started.

## 2. Candidates and the choice

Each point that asks for a change is listed here with a decision. We pick one change: the one that serves the case's assigned product change, changes what the founder sees, can be built and tested in the window, and does not move any rupee value in `data/expected.json`.

| Candidate change | Raised by (row in §1) | Decision | Reason |
|---|---|---|---|
| Profit headline gate: no contribution % until refund and recovery facts are complete | Pre-planned; link to the mentor row that supports it | Chosen | It is the case's product change ("Add refund and recovery semantics before a profit headline"), it is visible on the first screen a founder reads, and it changes no rupee value |
| Interface in Fynd's design language, with clickable KPI cards that open the number behind them | Internal review by the team lead, 17 Oct 2026: "the UI is clumsy … make it similar to Fynd's websites"; "these KPI cards also should be clickable" | Done (second change) | A founder should trust and explore the numbers without a manual. No rupee value changed; see §5 |
| | | Parked or declined | |

If the mentors ask for a different change and the team agrees, record it here, build that instead, and keep the headline gate as already shipped.

## 3. The chosen change: profit headline gate

### Rule

The headline figure, contribution as a percentage of net sales, is shown only when the facts behind it are complete:

```
headline_ready = (no in-period order is unknown) and (no returned order lacks refund or recovery facts)
headline_ready = false → contribution % is hidden and the reason is shown
```

Rupee contribution is still shown, labelled partial where it is partial. Only the percentage headline is gated, because it is the number a founder repeats to others.

### API

Every analysis response carries:

- `totals.headline_ready`: `true` or `false`
- `headline_gate`: `{ "open": true|false, "reason": "…" }`

Reason texts:

- open: "Refund and recovery facts are complete for every order in the period."
- closed: "Contribution % is hidden until refund and recovery facts are complete (n order(s) unknown)."

No rupee value changes, so `data/expected.json` is unchanged and the engine version stays 1.0.0 (see the version table in `docs/RULES.md`).

### Before and after

| Data | Before the change | After the change |
|---|---|---|
| Fixture (`Load sample orders`, all facts known) | Contribution % 41.7% (₹6,000 of ₹14,400 net sales) | Contribution % **41.7%**, gate open |
| Extended file (S04 refund, recovery and return cost unknown) | A contribution % was shown, computed over the known orders only; S04 was left out of the base with no warning on the figure | Contribution % **hidden**: "Contribution % is hidden until refund and recovery facts are complete (1 order unknown)." Contribution ₹7,053 still shown, labelled partial (1 unknown) |
| `null_refund.json` (O05 refund null) | A contribution % over 19 orders, with O05 left out | **Hidden**, 1 order unknown; ₹6,180 shown as partial |
| `missing_fee.json` (fee missing on every row) | No usable figure, shown as unknown | **Hidden**, 20 orders unknown |

### Tests

Assert in `tests/` (Track 4):

- fixture → `headline_ready: true`, `contribution_pct: 41.7`
- extended, `null_refund.json`, `missing_fee.json` → `headline_ready: false`, and the reason names the unknown count
- the rupee totals in `data/expected.json` are unchanged

### How to show it in the demo (3:15, 25 seconds)

1. Show the "before" screenshot: the Ledger strip with a contribution % next to a partial total. Take this screenshot from the build before the change and keep it in the slide deck.
2. Ledger on the extended file: point to "Contribution % hidden" and read the reason aloud. Point to S04's unknown chip.
3. Load the C21 fixture: the gate opens and shows 41.7%.
4. Say: "No percentage until refund and recovery facts are complete. That is the product change the case asks for."

## 4. What this gives the MBA team

The gate is the negotiated product change in `docs/mba/Venture_Brief.csv`. It is also the first thing to test with founders in the sample order audit (`docs/mba/Growth_Plan.csv`, week 2): does a founder trust a report more when it refuses to show a headline it cannot support?

## 5. Second change: the interface

Raised in the internal review on 17 Oct 2026 (§2). The engine and every number stayed the same; only presentation and navigation changed.

| Before | After |
|---|---|
| A quiet ledger page: one long table, small grey notes, no icons or charts | Fynd design language (colours from Fynd's Nitrozen design system, layout cues from fynd.com): sidebar with the five steps and their state, top bar with dataset, attribution switch and save status, white cards, pill buttons and tags |
| Totals as a line of figures | Six KPI cards; each opens what is behind it: the period waterfall (gross → net sales → contribution, from `analysis.bridge`), the headline-gate explanation with the unknown orders, the losing orders, the late refunds |
| No charts outside the order drawer | Contribution by channel, whale curve, ₹ lost by cause, candidate deltas, per-order waterfall — each with a table view |
| All scenario controls visible at once | One radio card per assumption, so "one change at a time" is visible in the control itself |

How to show it: on the Ledger, click the Contribution card to open the period waterfall (₹ 27,400 gross of computed orders → ₹ 19,900 net sales → ₹ 7,053), then click Orders to land on the six losing orders.
