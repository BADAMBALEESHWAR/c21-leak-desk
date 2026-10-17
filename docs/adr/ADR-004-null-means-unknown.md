# ADR-004: null → unknown status, not zero

- Status: Accepted
- Date: 2026-10-17
- Owner: M1 (Track 1), with M4 (Track 4) for the test files

## Context

The pack states "null means unknown, never zero". Check 3 reads: "Missing refund facts yield unknown or labelled scenario." Treating a missing refund as ₹0 would count a returned order as a full sale: on the fixture, O05 with a ₹0 refund would show +720 instead of −180 and overstate the total by ₹900. A founder would then trust a profit figure built on a fact nobody recorded.

## Decision

- If any input needed for an order's contribution is null, or its nullable key is absent, the order gets `status: "unknown"` and `contribution_inr: null`. The engine never coerces null to 0.
- Totals that would include an unknown order are labelled "partial (n unknown)"; reconciliation balances over the computed orders.
- A recommendation that depends on a null input is labelled confidence unknown and is not pre-selected.
- The headline gate stays closed while any order is unknown: contribution % is hidden (`totals.headline_ready: false`).
- An unknown is resolved only by supplying the fact, or by a scenario that states the assumption (`assume_unknown_refund`), which is saved in the decision's assumption snapshot.

## Consequences

- `null_refund.json` (O05 refund null) gives ₹6,180 labelled partial (1 unknown), confidence unknown, not ₹6,000 and not ₹6,900.
- `missing_fee.json` (payment fee removed from every row) gives 20 unknown orders and an unknown, partial total, with no error.
- The UI needs an explicit unknown chip and partial label on every surface that shows money; ₹0 and unknown never look alike.
- Required, non-nullable fields (`product_cost_inr` and others, see V1 in `docs/RULES.md`) are different: a file missing one of them fails validation with 422 and the field path.
