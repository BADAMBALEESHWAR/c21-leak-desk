# Business feedback and the change we made

Hour 10–12 is the mentor round (all four members, about 20 minutes). We record what mentors say word for word, choose one change, build it, and show the before and after in the demo. This file is the evidence for the "improvement after business feedback" criterion.

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
