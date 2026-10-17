# API contract (v1)

Base path `/api/v1`. JSON in and out unless noted. Every response carries `x-request-id` and `x-engine-version`.
Money fields end in `_inr` (whole rupees), percentages in `_pct` (0–100). `null` means unknown, never zero.
Types: `api/src/engine/types.ts`. Request schemas (Zod): `api/src/schema/orders.ts`. Rules: `docs/RULES.md`.

## Endpoints

| Method and path | Request | Response | Errors |
|---|---|---|---|
| `GET /health` | — | `{status: "ok"\|"degraded", db: "ok"\|"down"\|"memory", ai: "ok"\|"disabled"\|"degraded", storage: "local"\|"s3", engine_version, uptime_s}` | 503 when Mongo is configured but down |
| `GET /checks` | — | `{check1:{expected, actual, six_lines, pass}, check2:{allocate_total, channel_total, fixture_total, reconciled, never_both, channel_spend, pass}, check3:{unknown_labelled, confidence, before, after_recovery_50, recommendation_changed, pass}, all_pass, engine_version}` — computed live, compared with `data/expected.json` | — |
| `GET /worked-order` | — | six labelled lines, `contribution_inr: 230`, note | — |
| `GET /samples` | — | `[{source, label, description, file}]` | — |
| `POST /datasets` | `{source, period_end?}`, the fixture file shape `{records:{orders}}`, a bare `[orders]`, `text/csv`, or multipart field `file` (.json/.csv) | 201 `{dataset_id, source, rows_in, rows_kept, rows_rejected, kept_ids, synthetic_rows, flags:[{order_id, line, reason, detail, field?, path?, action}], warnings, period_end, schema_version, persisted}` | 413, 415, 422 |
| `GET /datasets/:id` | — | dataset summary and flags | 404 |
| `POST /datasets/:id/analyses` | `{attribution: "allocate"\|"channel", period_end?, config?: {handling_default_inr?}, channel_spend?: {channel: inr}}` | 201 `AnalysisResult & {analysis_id, dataset_id, persisted}` | 404, 409, 422 |
| `GET /analyses/:id` | — | as above | 404 |
| `GET /analyses/:id/orders/:order_id` | — | `{row, computed, waterfall:[{label, inr, note?}], status, flags}` | 404 |
| `GET /analyses/:id/export?format=csv\|json` | — | per-order ledger file (CSV for spreadsheets; empty cell = unknown) with totals and reconciliation rows | 404 |
| `GET /template.csv` | — | C21 CSV template: header plus a kept order, a return and a return with unknown refund facts | — |
| `POST /analyses/:id/narrate` | — | `{ai, leaks:[{cause, why, why_source}], recommendation:{why, why_source}}` — optional AI rewording; template on any failure | 404 |
| `POST /analyses/:id/scenarios` | `{overrides: exactly one of {return_rate_pct, recovery_pct, shipping_inr, refund_policy: "full"\|"partial", ads_per_order}, optionally with assume_unknown_refund: true}` | 201 `{scenario_id, changed, overrides, baseline, scenario, delta:{…, by_order[≤10]}, recommendation, baseline_recommendation, candidates[], assumptions[], observed, persisted}` | 404, 422 `override_invalid` |
| `GET /scenarios/:id` | — | stored scenario | 404 |
| `POST /scenarios/:id/test-plan` | — | `{intervention, test_30d, stop_rule, expected_delta_inr, source}` | 404 |
| `POST /analyses/:id/decisions` | `{scenario_id?, intervention, expected_delta_inr, test_30d, stop_rule, owner, notes?}` | 201 `{decision_id, saved_at, assumptions, engine_version, persisted}` | 404, 422 (field path), 503 |
| `GET /decisions` · `GET /decisions/:id` | — | list · full record with assumption snapshot and evidence | 404 |
| `GET /decisions/:id/export?format=md\|json` | — | file download; Markdown includes the three check values | 404 |

Sample sources: `fixture`, `extended`, `duplicate_order`, `late_refund`, `null_refund`, `missing_fee`, `refund_over_gross`, `recovery_400`, `bad_schema`.

## Error body (Blueprint §16.1)

```json
{ "error": { "code": "schema_invalid", "message": "product_cost_inr is missing from the CSV header.", "path": "product_cost_inr", "hint": "Add the column product_cost_inr in the C21 schema.", "issues": [{ "path": "product_cost_inr", "message": "column is missing" }] } }
```

| HTTP | code | When |
|---|---|---|
| 413 | `file_too_large` | over 5 MB or 10,000 rows |
| 415 | `unsupported_type` | not JSON or CSV |
| 422 | `schema_invalid` | missing or mistyped field; `path` names it |
| 422 | `no_valid_rows` | every row rejected; `issues` lists each |
| 422 | `override_invalid` | scenario with zero or several overrides |
| 404 | `not_found` | unknown dataset, analysis, scenario, decision or order |
| 409 | `attribution_conflict` | explicit channel spend with per-order ads in allocate mode; `hint` is the rule |
| 503 | `db_unavailable` | Mongo down on a decision save (analyses still compute, `persisted: false`) |

## AnalysisResult (abridged, extended sample, allocate mode)

```json
{
  "engine_version": "1.0.0", "attribution": "allocate", "period_end": "2026-09-30",
  "config": { "handling_default_inr": 0 }, "channel_spend": {},
  "labels": ["Attribution is allocation, not causation.", "Operational contribution, not statutory net profit.", "..."],
  "totals": { "orders": 27, "gross_inr": 28400, "net_sales_inr": 19900, "contribution_inr": 7053, "contribution_pct": 35.4,
              "negative_count": 6, "unknown_count": 1, "partial": true, "channel_spend_inr": 0,
              "late_refund_count": 1, "late_refund_pending_inr": -600, "headline_ready": false },
  "reconciliation": { "orders_inr": 7053, "channels_inr": 7053, "products_inr": 7053, "gap_inr": 0, "tolerance_inr": 1, "ok": true, "partial": true,
                      "statement": "Σ orders = Σ channels = Σ products" },
  "orders": [{ "order_id": "S06", "status": "ok", "contribution_inr": 350, "recognised_contribution_inr": -250, "flags": ["late_refund"],
               "inputs": { "...": "..." }, "derived": { "net_sales": 900, "net_product_cost": 400, "ads_allocated": 50, "contribution": 350 },
               "leak_cause": null, "labels": ["Attribution is allocation, not causation.", "synthetic row"], "lines": ["…nine labelled lines…"] }],
  "groups": { "channel": ["GroupRow"], "product": ["GroupRow"], "product_unallocated_spend_inr": 0, "product_label": "after allocated ads" },
  "leaks": [{ "cause": "full_return_partial_recovery", "label": "Full return, partial recovery", "count": 5, "lost_inr": 1384,
              "order_ids": ["O05", "O10", "O15", "O20", "S03"], "why": "…", "why_source": "template" }],
  "late_refunds": { "period_end": "2026-09-30", "orders": ["S06"], "pending_delta_inr": -600, "total_if_recognised_inr": 6453 },
  "observed": { "return_rate_pct": 22.2, "recovery_pct": 71.4, "avg_return_cost_inr": 56, "...": "..." },
  "headline_gate": { "open": false, "reason": "Contribution % is hidden until refund and recovery facts are complete (1 order unknown)." },
  "recommendation": { "intervention": "raise_recovery_via_inspection", "expected_delta_inr": 390, "confidence": "unknown", "preselect": false, "why": "…" },
  "candidates": [{ "intervention": "raise_recovery_via_inspection", "delta_inr": 390, "driving_orders": 5 }, "…"],
  "whale": [{ "rank": 1, "order_id": "S01", "contribution_inr": 680, "cumulative_inr": 680 }, "…"]
}
```

`bridge` (period waterfall over computed orders) lists Gross sales → Discounts → Refunds → Net sales (subtotal) → Net product cost → Shipping → Payment fees → Return costs → Handling → Ads on orders → Channel spend (channel mode) → Contribution (total). Its start and deduction lines sum to `totals.contribution_inr`; its gross can be lower than `totals.gross_inr`, which also counts unknown orders.

Exact expected values for every sample: `data/expected.json`. The engine is pure: the same rows, options and engine version give byte-identical output.
