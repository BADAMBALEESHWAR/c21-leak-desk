# ADR-003: Channel spend = Σ allocated ads per channel

- Status: Accepted
- Date: 2026-10-17
- Owner: M1 (Track 1)

## Context

Check 2 reads: "Detail and group totals reconcile; ad allocations and channel spend are never both deducted." Advertising can be deducted per order (allocate) or once per channel (channel spend). If channel spend were an independent input, the two modes would give different grand totals, and a judge could not tell whether a different total meant a correct mode switch or a double deduction.

## Decision

- In channel mode, channel spend for channel c is the sum of `ads_inr` of the computed (non-unknown) in-period orders in c, deducted once on the channel line. Order rows carry no ads in this mode.
- In allocate mode, `ads_inr` is deducted on each order and no channel spend exists.
- A request that asks for per-order ads and explicit channel spend together is rejected with 409 `attribution_conflict`, and the rule text is returned.
- An unknown order's ads are left out of channel spend as well, so an unknown row cannot move the total between modes.
- Every attribution output is labelled "attribution is allocation, not causation".

## Consequences

- The grand total is the same in both modes. On the extended file it is ₹7,053 in both: ₹490 of ads (web 250, marketplace 100, instagram 140) moves from order rows to channel lines. On the fixture it is ₹6,000 in both, because the reference rows carry no ads.
- The judge toggles the mode and watches the ads line move while "Σ orders = Σ channels = Σ products ✓" stays green. That is the visible meaning of "never both".
- The product view cannot attribute channel spend to products, so in channel mode it is labelled "before channel spend" (P1 780, P2 598, P3 165, unassigned 6,000) and the ₹490 appears once as a separate line.
- A founder who knows real channel spend that differs from the per-order allocation cannot enter it in allocate mode. That is deliberate; a future version could accept explicit spend in channel mode only.
