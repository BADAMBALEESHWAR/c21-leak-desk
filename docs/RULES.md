# Business rules (engine 1.0.0)

Every rupee Leak Desk shows comes from the pure functions in `api/src/engine/`. This file states each rule, its formula and the worked numbers it produces on the case data. The expected totals are fixed in `data/expected.json`; where this file and that file ever disagree, `data/expected.json` is right and this file is out of date.

Leak Desk reports operational contribution, not statutory net profit. It excludes fixed costs, taxes and finance costs.

## Conventions

- Money fields end in `_inr` and are whole rupees. Percentages end in `_pct` and run from 0 to 100.
- `null` means unknown, never zero. A missing nullable key is read as `null`.
- Period end defaults to **2026-09-30**: the last day of the month of the latest order date. Blueprint §6.3 says "last order date", but Blueprint §8.2 and every expected value use 2026-09-30, and a monthly contribution report closes on a month end, so the engine uses the month end. The operator can set another date on the Import screen ("Period as-of date") or with `period_end` on the API.
- Rows without `channel` or `product_id` go to `unassigned`.

## The data the worked numbers use

| Set | Rows | What is in it |
|---|---|---|
| Worked order (`records.worked_order` in the fixture) | 1 | Revenue 1,000; refund 200; net product cost 400 (already after recovery); shipping 50; ads 100; handling 20; expected 230 |
| Fixture `data/C21/fixture.json` | 20 | Every order: gross 1,000, discount 100, product cost 400, shipping 60, payment fee 20. 16 kept orders: refund 0, recovered 0, return cost 0. 4 returned orders (O05, O10, O15, O20): refund 900, recovered 350, return cost 50. No handling, ads, channel or product. |
| Extended `data/C21_extended.json` | 20 reference + 8 synthetic | The 20 reference rows unchanged, plus S01–S08 with `synthetic: true`. The row labelled S05 carries `order_id` S01 (the duplicate). |
| Negative tests `data/negative_tests/` | 7 files | One file per changed input; see V1–V9 and the drills in `docs/DEMO.md`. |

Synthetic rows S01–S08 (₹):

| Row | Channel | Product | Gross | Disc | Refund | PCost | Recov | Ship | Fee | RetC | Ads | Hand | Purpose |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| S01 | web | P1 | 1,500 | 0 | 0 | 600 | 0 | 70 | 30 | 0 | 100 | 20 | Healthy large order |
| S02 | marketplace | P2 | 800 | 300 | 0 | 450 | 0 | 60 | 16 | 0 | 50 | 20 | Discount exceeds margin |
| S03 | instagram | P3 | 1,200 | 100 | 1,100 | 500 | 100 | 60 | 24 | 80 | 80 | 20 | Full return, partial recovery |
| S04 | web | P1 | 1,000 | 100 | null | 400 | null | 60 | 20 | null | 50 | 20 | Refund facts unknown |
| S05 (order_id S01) | web | P1 | 1,500 | 0 | 0 | 600 | 0 | 70 | 30 | 0 | 100 | 20 | Duplicate of S01, dropped |
| S06 | marketplace | P2 | 1,000 | 100 | 900 | 400 | 350 | 60 | 20 | 50 | 50 | 20 | Late refund, refund_date 2026-10-05 |
| S07 | web | P3 | 2,000 | 200 | 0 | 900 | 0 | 90 | 36 | 0 | 150 | 25 | Healthy |
| S08 | instagram | P2 | 900 | 100 | 0 | 400 | 0 | 120 | 16 | 0 | 60 | 20 | Heavy shipping, still positive (control row) |

## R1 — Net sales

```
net_sales = gross_inr − discount_inr − refund_inr
refund_inr is null → net_sales is null → order status unknown
```

The engine recomputes net sales on every row. The file's `net_sales_inr` is only a cross-check (V4).

| Case | Working | Net sales |
|---|---|---:|
| Fixture kept order | 1,000 − 100 − 0 | 900 |
| Fixture returned order | 1,000 − 100 − 900 | 0 |
| Fixture, 20 orders | 16 × 900 + 4 × 0 | ₹14,400 (gross ₹20,000) |
| S02 | 800 − 300 − 0 | 500 |
| S04 | 1,000 − 100 − null | unknown |

## R2 — Net product cost, recovery subtracted once

```
net_product_cost = product_cost_inr − recovered_product_cost_inr
recovered_product_cost_inr is null → unknown
a row that supplies net_product_cost_inr (the worked order) is used as is; recovery is never subtracted again
```

"Recovered" is the stock value that came back after a return. It reduces product cost once. It is never also added back as revenue.

| Case | Working | Net product cost |
|---|---|---:|
| Fixture kept order | 400 − 0 | 400 |
| Fixture returned order (O05) | 400 − 350 | 50 |
| S03 | 500 − 100 | 400 |
| Worked order | supplied as 400, already net | 400 |
| Recovery 400 drill | 400 − 400 | 0 |

Subtracting recovery twice on O05 would give 400 − 350 − 350 = −300, a negative cost that would lift the order from −180 to +170. The engine cannot reach that state: it uses either the gross product cost and the recovery, or a supplied net figure, never both.

## R3 — Advertising attribution: allocate or channel, never both

```
mode = allocate : ads_allocated = ads_inr (0 if absent); no channel spend
mode = channel  : ads_allocated = 0 on every order;
                  channel_spend[c] = Σ ads_inr of computed (non-unknown) in-period orders in channel c,
                  deducted once on the channel line
a request that asks for per-order ads and explicit channel spend together → 409 attribution_conflict
```

Every attribution output carries the label "attribution is allocation, not causation". Ads are spread by rule; the product makes no claim that an ad caused an order.

Worked numbers on the extended file:

| Channel | Ads on computed orders | Channel spend in channel mode |
|---|---|---:|
| web | S01 100 + S07 150 (S04's 50 is left out because S04 is unknown) | 250 |
| marketplace | S02 50 + S06 50 | 100 |
| instagram | S03 80 + S08 60 | 140 |
| unassigned | reference rows carry no ads | 0 |
| Total | | 490 |

The same ₹490 is deducted on order rows in allocate mode and on channel lines in channel mode, so the grand total is ₹7,053 in both (ADR-003).

## R4 — Handling

```
handling = handling_inr if the row has the key, else handling_default_inr
handling_default_inr = 0, labelled "config default (estimate)"
```

**This differs from Blueprint §6.3, which sets the default to ₹20.** The fixture has no handling column. A ₹20 default would turn every kept order into 900 − 400 − 60 − 20 − 20 = 400 and every returned order into −200, so the fixture would total 16 × 400 + 4 × (−200) = ₹5,600 instead of the pack's +420 per kept order and ₹6,000. The worked order supplies its own handling of 20, so check 1 is unaffected either way.

The default can be changed per analysis with `config.handling_default_inr` (alias `config.handling_inr`). Whatever the value, the waterfall line shows "Not in the source row; config default (estimate)".

| Case | Handling |
|---|---:|
| Fixture rows (no key) | 0, labelled estimate |
| S01–S06, S08 | 20 (from the row) |
| S07 | 25 (from the row) |
| Worked order | 20 (from the row) |

## R5 — Operational contribution

```
contribution = net_sales − net_product_cost − shipping_inr − payment_fee_inr
               − return_cost_inr − handling − ads_allocated
any term null → contribution null, status unknown (R6)
```

| Case | Working | Contribution |
|---|---|---:|
| Worked order (check 1) | 1,000 − 200 − 400 − 50 − 100 − 20 | **230** |
| Fixture kept order | 900 − 400 − 60 − 20 − 0 − 0 − 0 | **420** |
| Fixture returned order | 0 − 50 − 60 − 20 − 50 − 0 − 0 | **−180** |
| Fixture, 20 orders | 16 × 420 + 4 × (−180) = 6,720 − 720 | **₹6,000** |

The worked order has only six lines (revenue, refund, net product cost, shipping, ads, handling): it carries no discount, payment fee or return cost.

Extended file, allocate mode, period end 2026-09-30:

| Row | Working | Contribution |
|---|---|---:|
| S01 | 1,500 − 600 − 70 − 30 − 0 − 20 − 100 | +680 |
| S02 | 500 − 450 − 60 − 16 − 0 − 20 − 50 | −96 |
| S03 | 0 − 400 − 60 − 24 − 80 − 20 − 80 | −664 |
| S04 | refund, recovered and return cost are null | unknown |
| S05 | duplicate of S01 (R7) | dropped |
| S06 | 900 − 400 − 60 − 20 − 0 − 20 − 50 (late refund, counted as kept in the period, R8) | +350 |
| S07 | 1,800 − 900 − 90 − 36 − 0 − 25 − 150 | +599 |
| S08 | 800 − 400 − 120 − 16 − 0 − 20 − 60 | +184 |
| Synthetic subtotal | six computed rows | +1,053 |
| Reference subtotal | 16 × 420 + 4 × (−180) | +6,000 |
| **Grand total** | partial (1 unknown); 1 late refund pending, −₹600 if recognised | **₹7,053** |

## R6 — Unknown semantics

- An unknown order is shown with an unknown chip and no contribution value. It is never shown as ₹0.
- Totals that would include it are labelled "partial (n unknown)". Reconciliation still balances over the computed orders.
- An unknown order's ads stay out of channel spend too, so the total does not move when the mode changes (S04's ₹50 in R3).
- A recommendation whose inputs include a null is labelled confidence unknown and is not pre-selected on the Decision screen.
- The headline gate stays closed: `totals.headline_ready` is false and contribution % is hidden (see `docs/FEEDBACK.md`).
- An unknown is resolved only by supplying the fact (re-import) or by a scenario that states the assumption (`assume_unknown_refund`, R12), which is saved in the decision's snapshot.

| Case | Result |
|---|---|
| Extended, S04 | S04 unknown; total ₹7,053 labelled partial (1 unknown) |
| `null_refund.json` (O05 refund null) | O05 unknown; total 16 × 420 + 3 × (−180) = **₹6,180**, partial (1 unknown); confidence unknown |
| `missing_fee.json` (payment_fee_inr removed from every row) | 20 of 20 orders unknown; no order can be computed, so the contribution total is unknown and labelled partial; no error, no crash |

## R7 — Duplicate order

```
group rows by order_id in file order
keep the first row; flag each later row {order_id, reason: "duplicate", line}; exclude it
order count = count of kept rows
```

| Case | Result |
|---|---|
| `duplicate_order.json` (O07 appears twice, 21 rows) | 20 orders, 1 duplicate flag, total ₹6,000 unchanged |
| Extended, row S05 (order_id S01) | Dropped and listed in the flag report; S01 counted once at +680 |

## R8 — Late refund

```
late = returned and refund_date is set and refund_date > period_end
in the period : refund, recovered cost and return cost are treated as not yet occurred
                (the order counts as kept); the row is flagged "late refund"
recognised    : the same row with the refund recognised (shown beside it, and as a scenario)
ledger        : uses the in-period value and states "n late refunds pending, −₹X if recognised"
```

| Case | In the period | If recognised | Pending change |
|---|---:|---:|---:|
| Extended, S06 (refund_date 2026-10-05) | 900 − 400 − 60 − 20 − 0 − 20 − 50 = +350 | 0 − 50 − 60 − 20 − 50 − 20 − 50 = −250 | −₹600 |
| `late_refund.json`, O10 (refund_date 2026-10-05) | +420; total 17 × 420 + 3 × (−180) = ₹6,600 | −180; total ₹6,000 | −₹600 |

## R9 — Full return with partial recovery

```
condition    : returned and refund = gross − discount and 0 < recovered < product_cost
contribution : −(product_cost − recovered) − shipping − fee − return_cost − handling − ads_allocated
leak cause   : full_return_partial_recovery
```

| Case | Working | Contribution |
|---|---|---:|
| Fixture O05 (and O10, O15, O20) | −(400 − 350) − 60 − 20 − 50 − 0 − 0 | −180 |
| S03 | −(500 − 100) − 60 − 24 − 80 − 20 − 80 | −664 |

## R10 — Leak causes

Evaluated in this order; the first match wins. A leak is an order with negative contribution, or an unknown returned order.

| Order | Cause | Condition |
|---|---|---|
| 1 | `refund_unknown` | returned, and any of refund, recovered, return cost is null |
| 2 | `full_return_partial_recovery` | returned, refund = gross − discount, recovered < product cost |
| 3 | `discount_exceeds_margin` | not returned, discount > 0, net sales − net product cost < shipping + fee + handling + ads_allocated, and discount ≥ that shortfall |
| 4 | `fees_exceed_margin` | not returned, contribution < 0, not explained by the discount |

Groups are listed by rupees lost, largest first; a group with an unknown amount is listed last. The engine ranks; text never re-ranks.

| Data | Cause | Orders | ₹ lost |
|---|---|---|---:|
| Fixture | full_return_partial_recovery | O05, O10, O15, O20 | 720 |
| Extended, allocate | full_return_partial_recovery | O05, O10, O15, O20, S03 | 1,384 (4 × 180 + 664) |
| Extended, allocate | discount_exceeds_margin | S02 | 96 (margin 500 − 450 = 50 against 60 + 16 + 20 + 50 = 146; shortfall 96; discount 300 ≥ 96) |
| Extended, allocate | refund_unknown | S04 | unknown |

S08 (+184) is the control row: heavy shipping, still positive, so it is not a leak.

## R11 — Reconciliation

```
A = Σ contribution of computed orders − (mode = channel ? Σ channel_spend : 0)
B = Σ over channels of (Σ contribution of the channel's orders − (mode = channel ? channel_spend[c] : 0))
C = Σ over products of Σ contribution of the product's orders − (mode = channel ? Σ channel_spend : 0)
ok = max(A, B, C) − min(A, B, C) ≤ ₹1
```

In channel mode the order rows carry no ads, and ads cannot be attributed to a product, so the product view is labelled "before channel spend" and the spend appears once as a separate line. The judge-facing sentence reads "Σ orders = Σ channels = Σ products ✓", or shows the rupee gap in red.

Extended file:

| Group | Allocate mode | Channel mode |
|---|---:|---|
| web | 1,279 | 1,529 − 250 = 1,279 |
| marketplace | 254 | 354 − 100 = 254 |
| instagram | −480 | −340 − 140 = −480 |
| unassigned | 6,000 | 6,000 − 0 = 6,000 |
| **Σ channels** | **7,053** | **7,053** |
| P1 / P2 / P3 / unassigned | 680 / 438 / −65 / 6,000 | 780 / 598 / 165 / 6,000 before channel spend |
| **Σ products** | **7,053** | 7,543 − 490 = **7,053** |
| **Σ orders** | **7,053** | 7,543 − 490 = **7,053** |

Fixture: Σ orders = Σ channels = Σ products = ₹6,000 in both modes; every row sits in `unassigned` and carries no ads.

## R12 — Scenario overrides

A scenario is a deep copy of the analysis inputs with **exactly one** override, recomputed by the same engine version. `assume_unknown_refund` may be added to any override. Zero overrides, or two or more, return 422 `override_invalid`. Nothing in the stored analysis is changed.

| Override | Applied as | Worked number on the fixture (baseline ₹6,000) |
|---|---|---|
| `recovery_pct` | recovered = product cost × pct on every returned order | 50 → recovered 200; each return 0 − 200 − 60 − 20 − 50 = −330; total ₹5,400 |
| `return_rate_pct` | convert the lowest-contribution kept orders to returned, in order_id order, at the current average recovery, until the rate is reached | 30 → 6 of 20 returned (O01 and O02 added); total 14 × 420 + 6 × (−180) = 5,880 − 1,080 = ₹4,800 |
| `shipping_inr` | replace shipping on every order | 80 → 20 more per order; total ₹5,600 |
| `refund_policy` | full: refund = gross − discount on returned orders; partial: refund = (gross − discount) × 0.8 | partial → refund 720, each return 0; total ₹6,720. full → ₹6,000 (fixture refunds are already full) |
| `ads_per_order` | replace ads on every order (allocate), or channel spend = order count × value (channel) | 10 → ₹200 of ads; total ₹5,800 in both modes |
| `assume_unknown_refund` | unknown rows only: a null refund becomes gross − discount and a null recovered cost becomes 0; labelled as an assumption | `null_refund.json` (baseline ₹6,180 partial): O05 refund set to 900 (its recovered 350 is known) → O05 −180, total ₹6,000, labelled "assumed", confidence low |

The same overrides on `null_refund.json`, where O05 is unknown and only 3 returned orders are computed: recovery_pct 50 → ₹5,730 (6,180 − 3 × 150); return_rate_pct 30 → ₹4,980.

## R13 — Recommendation

```
candidates (each run as its own single-change scenario on the current scenario):
  raise_recovery_via_inspection  recovered → 90% of product cost on returned orders
  charge_return_shipping         return cost → 0 (the customer pays return shipping)
  cap_discount                   discount ≤ 15% of gross
  add_handling_to_price          price + handling
delta = candidate total − scenario total
recommendation = the largest positive delta (none positive → "no change")
confidence = unknown if any input to the delta is null
           = low if fewer than 5 orders drive the delta
           = high otherwise
why = Handlebars template; an optional rewrite is labelled "ai" and kept only if every rupee figure in it is in the input
```

All four candidates and their deltas are returned, so the choice is auditable.

| Data and scenario | raise_recovery_via_inspection | charge_return_shipping | cap_discount | add_handling_to_price | Recommendation |
|---|---:|---:|---:|---:|---|
| Fixture, baseline (recovery 87.5%) | 4 × 400 × 2.5 points = +40 | 4 × 50 = +200 | 0 (discounts are 10% of gross) | 0 (handling ₹0) | charge_return_shipping ₹200, confidence low (4 returns) |
| Fixture, recovery_pct 50 | 4 × 400 × 40 points = +640 | +200 | 0 | 0 | raise_recovery_via_inspection ₹640, confidence low (4 returns) |
| Fixture, return_rate_pct 30 (total ₹4,800) | 6 × 400 × 2.5 points = +60 | 6 × 50 = +300 | 0 | 0 | charge_return_shipping ₹300, confidence high (6 returns) |
| `null_refund.json`, baseline (₹6,180 partial) | 3 × 400 × 2.5 points = +30 | 3 × 50 = +150 | 0 | 0 | charge_return_shipping ₹150, **confidence unknown** (O05) |
| `null_refund.json`, recovery_pct 50 (₹350 → ₹200 per return; total ₹5,730) | 3 × 400 × 40 points = +480 | +150 | 0 | 0 | **raise_recovery_via_inspection ₹480**, confidence unknown |
| `null_refund.json`, return_rate_pct 30 (total ₹4,980) | 5 × 400 × 2.5 points = +50 | 5 × 50 = +250 | 0 | 0 | charge_return_shipping ₹250, confidence unknown |
| Extended, baseline (allocate) | 4 × 400 × (90% − 87.5%) + 500 × (90% − 20%) = 40 + 350 = +390 | 4 × 50 + 80 = +280 | smaller than ₹390 | smaller than ₹390 | raise_recovery_via_inspection ₹390, confidence unknown (S04) |

The two `null_refund.json` rows in bold are check 3: missing refund facts give an unknown label, and changing the return assumption changes the recommendation. On `null_refund.json` O05 is unknown, so only the 3 computed returns (O10, O15, O20) drive the deltas.

## Validation rules (import time)

| ID | Rule | Outcome | Worked case |
|---|---|---|---|
| V1 | Required fields present with the right types; dates parse as ISO dates. Required and not nullable: `order_id`, `date`, `gross_inr`, `discount_inr`, `product_cost_inr`, `shipping_inr`, `returned`. | Row rejected with its field path. File accepted if at least one row is valid; otherwise 422. | `bad_schema.csv` has no `product_cost_inr` column, so every row fails: **422 with path `product_cost_inr`**. |
| V2 | gross ≥ 0; 0 ≤ discount ≤ gross; refund ≤ gross − discount | Row flagged invalid, excluded, listed | `refund_over_gross.json`: O03 refund 1,500 > 1,000 − 100 = 900 → O03 excluded; **19 orders, ₹5,580** (6,000 − 420). |
| V3 | recovered_product_cost ≤ product_cost | Row flagged invalid, excluded, listed | A row with recovered 450 on product cost 400 is excluded: "recovered_product_cost_inr is greater than product_cost_inr on … — row excluded." |
| V4 | net_sales_inr, if given, equals gross − discount − refund within ₹1 | Row kept, flagged mismatch; engine value used | All 20 fixture rows match (900 = 1,000 − 100 − 0; 0 = 1,000 − 100 − 900). A kept row stating 950 would be flagged and computed at 900. |
| V5 | order_id unique | Later occurrence flagged duplicate, excluded (R7) | `duplicate_order.json`: 20 orders, 1 flag, ₹6,000. Extended: row S05 (order_id S01) dropped. |
| V6 | refund_date ≤ period_end | Otherwise flagged late refund (R8) | S06 and the O10 drill: 2026-10-05 > 2026-09-30. |
| V7 | Any of refund, recovered, payment fee, return cost is null or its key is absent | Row kept, status unknown (R6) | S04; `null_refund.json` → ₹6,180 partial; `missing_fee.json` → 20 unknown. |
| V8 | Unknown keys | Warned once per key, ignored | A `coupon_code` column would be listed under schema warnings; the row is kept. `note`, `channel`, `product_id`, `ads_inr`, `handling_inr`, `refund_date`, `synthetic` and `net_product_cost_inr` are known extensions. |
| V9 | File ≤ 5 MB, ≤ 10,000 rows, JSON or CSV in UTF-8 | 413 over the size or row cap; 415 for another type; 422 for an unreadable file | A 6 MB file returns 413 `file_too_large`; a `.xlsx` returns 415. |

## Engine version history

`data/expected.json` records `engine_version: "1.0.0"`; `/api/v1/health` and `/api/v1/checks` report the same string.

| Version | Date | Change | Expected values |
|---|---|---|---|
| 1.0.0 | 2026-10-17 | First rule set: R1–R13 and V1–V9 as above. Handling default ₹0 (labelled estimate). Period end defaults to the month end of the latest order. Late refunds count as kept in the period, with the recognised value and the pending change shown beside them. Channel spend = Σ allocated ads of computed orders per channel. Headline gate (`totals.headline_ready`) added; it hides contribution % and changes no rupee value. | Worked order 230; fixture ₹6,000; extended ₹7,053 |

A rule change needs three things in the same pull request: a version bump in the engine, an ADR in `docs/adr/`, and updated values in `data/expected.json` with a new row in this table. Every analysis and decision stores the version it was computed with, so an old decision can be re-run under its own rules.
