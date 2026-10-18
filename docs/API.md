# API contract (v1)

Base path `/api/v1`. JSON in and out unless noted. Every response carries `x-request-id` and `x-engine-version`.
Money fields end in `_inr` (whole rupees), percentages in `_pct` (0–100). `null` means unknown, never zero.
Types: `api/src/engine/types.ts`. Request schemas (Zod): `api/src/schema/orders.ts`. Rules: `docs/RULES.md`.
Internal names keep the engine's record name (`leakdesk-api`, `/leakdesk/*`); the product is Profyn.

## Endpoints

| Method and path | Request | Response | Errors |
|---|---|---|---|
| `GET /auth/config` | — | `{enabled, domain, client_id, region}` — public sign-in settings, no secrets; `domain` and `client_id` are `null` when sign-in is off | — |
| `GET /me` | — | `{user: {sub, email} \| null, auth_enabled, workspace: "account"\|"demo"}` | 401 |
| `GET /workspace` | Bearer token | Signed in: `{workspace: "account", user, datasets: [{dataset_id, source, period_end, rows_kept, files, created_at, latest_analysis: {analysis_id, attribution, created_at, contribution_inr} \| null}], latest: {dataset_id, analysis_id} \| null}`, newest first; a dataset that was added to is listed only as its newest version. Without a token: `{workspace: "demo", user: null, datasets: [], latest: null}` | 401 |
| `GET /health` | — | `{status: "ok"\|"degraded", db: "ok"\|"down"\|"memory", ai: "ok"\|"disabled"\|"degraded", storage: "local"\|"s3", engine_version, uptime_s}` | 503 when Mongo is configured but down |
| `GET /checks` | — | `{check1:{expected, actual, six_lines, pass, lines[]}, check2:{allocate_total, channel_total, fixture_total, reconciled, never_both, channel_spend, pass, rows[], conflict}, check3:{unknown_labelled, confidence, before, after_recovery_50, recommendation_changed, pass, assumption_control}, check4:{net_revenue_inr, cm1_pct, cm2_pct, cm3_pct, formulas, working, pass, …}, all_pass, engine_version, ms}` — computed live, compared with `data/expected.json`; read-only. `all_pass` includes check 4. Field shapes: [Checks](#checks) | — |
| `GET /checks/missing-refund?return_rate_pct=X` | `X` 0–100 (optional; default the first rate that changes the label, 0) | The null_refund drill re-run with the single override `return_rate_pct: X`; see [Checks](#checks). Read-only | 422 `schema_invalid` (`path: "return_rate_pct"`) |
| `GET /i18n/labels?lang=en\|hi\|te` | `?lang=` or `Accept-Language` | `{lang, languages: ["en","hi","te"], candidates: [{intervention, label, description}] (the four rules), no_change: {intervention: "none", label, description}}`; see [Languages](#languages) | — |
| `GET /worked-order` | — | six labelled lines, `contribution_inr: 230`, note | — |
| `GET /samples` | — | `[{source, label, description, file}]` | — |
| `POST /datasets` | `{source, period_end?}`, the fixture file shape `{records:{orders}}`, a bare `[orders]`, `text/csv`, or multipart field `file` (.json/.csv), repeated for up to 12 files that are merged into one dataset (e.g. one CSV per month; 5 MB each, 10,000 orders in total) | 201 `{dataset_id, source, rows_in, rows_kept, rows_rejected, kept_ids, synthetic_rows, flags:[{order_id, line, file?, reason, detail, field?, path?, action}], warnings, period_end, schema_version, files?:[{name, rows}], persisted}`. With several files, every flag names its `file` and that file's own `line`; an `order_id` already seen in an earlier file is a duplicate (second one dropped). Optional `append_to=<dataset_id>` (form field or query) adds the upload to that saved dataset: orders whose id is already saved are ignored (flag "… is already saved — ignored."), the result is a new dataset version (`rows_added`, `duplicates_ignored`, `appended_to`, `files` so far); when nothing is new the answer is 200 `{unchanged: true, rows_added: 0, duplicates_ignored, message}` and the saved dataset stays as it was | 404, 413, 415, 422 |
| `GET /datasets/:id` | — | dataset summary and flags, with `rejected_rows`, `corrections`, `corrected_order_ids` (and `supersedes` for a later version) | 404 |
| `PATCH /datasets/:id/rows` | `{order_id?, line?, file?, changes: {<field>: value \| null}, note?}` | 201 a new dataset version: summary + `corrections_added`, `still_flagged`, `persisted`; see [Corrections](#corrections) | 404, 422 |
| `POST /datasets/:id/analyses` | `{attribution: "allocate"\|"channel", period_end?, config?: {handling_default_inr?}, channel_spend?: {channel: inr}}`; `?lang=` | 201 `AnalysisResult & {analysis_id, dataset_id, persisted, margins, lang}`; every `groups.channel[]` and `groups.product[]` row also has `margins` ([Unit economics](#unit-economics-margins)); `leaks[].why` and the recommendation's `why`, `test_30d_draft`, `stop_rule_draft` are in `lang` | 404, 409, 422 |
| `GET /analyses/:id` | `?lang=` | as above | 404 |
| `GET /analyses/:id/orders/:order_id` | — | `{row, computed, waterfall:[{label, inr, note?}], status, flags}` | 404 |
| `GET /analyses/:id/pulse/:view` | `view`: `overview`, `months`, `products`, `channels`, `leaks` or `insights`; `?month=YYYY-MM` for `overview` (default: the latest month) | `{analysis_id, …view fields, labels, unknown_count, synthetic_rows}`; see Pulse below | 404 (unknown analysis or view) |
| `GET /analyses/:id/export?format=csv\|json` | `?lang=` (JSON) | per-order ledger file (CSV for spreadsheets; empty cell = unknown) with totals and reconciliation rows; JSON is the analysis response above | 404 |
| `GET /template.csv` | — | C21 CSV template: header plus a kept order, a return and a return with unknown refund facts | — |
| `POST /analyses/:id/narrate` | `?lang=` | `{ai, lang, leaks:[{cause, why, why_source, reason?}], recommendation:{why, why_source, reason?}}` — optional AI rewording in `lang`; template text in `lang` on any failure | 404 |
| `POST /analyses/:id/scenarios` | `{overrides: exactly one of {return_rate_pct, recovery_pct, shipping_inr, refund_policy: "full"\|"partial", ads_per_order}, optionally with assume_unknown_refund: true}`; `?lang=` | 201 `{scenario_id, changed, overrides, baseline, scenario, delta:{…, by_order[≤10]}, recommendation, baseline_recommendation, candidates[], assumptions[], observed, persisted, margins: {baseline: Margins, scenario: Margins}, lang}` | 404, 422 `override_invalid` |
| `GET /scenarios/:id` | `?lang=` | stored scenario with `margins` and `lang` | 404 |
| `POST /scenarios/:id/test-plan` | `?lang=` | `{intervention, test_30d, stop_rule, expected_delta_inr, source, lang}` | 404 |
| `POST /analyses/:id/decisions` | `{scenario_id?, intervention, expected_delta_inr, test_30d, stop_rule, owner, notes?, fixed_costs_inr?}` — `fixed_costs_inr` ≥ 0, fixed costs per period (salaries, rent, tools), an assumed input | 201 `{decision_id, saved_at, assumptions, engine_version, persisted, workspace: "demo"\|"account"\|"shared", check_in_30_days, assumed_inputs[], export_url}` | 404, 422 (field path), 503 |
| `GET /decisions` · `GET /decisions/:id` | — | list · full record with assumption snapshot and evidence; new records also carry `fixed_costs_inr?`, `starting_state`, `check_in_30_days`, `assumed_inputs[]` | 404 |
| `GET /decisions/:id/export?format=md\|json` | — | file download `decision-<id>.md` or `decision-<id>.json`. Markdown includes the three check values and the 30-day check-in; JSON is the [decision file](#decision-file) | 404 |

Sample sources: `fixture`, `extended`, `duplicate_order`, `late_refund`, `null_refund`, `missing_fee`, `refund_over_gross`, `recovery_400`, `bad_schema`, `bad_values`, `demo_12m` (3,020 labelled synthetic orders, Oct 2025–Sep 2026, for Pulse; never used by `/checks`).

`bad_values` (`data/negative_tests/bad_values.csv`, label "Bad values (CSV)") is ten C21 rows with a negative product cost (O03, line 4), a text gross (O06, line 7) and a bad date (O08, line 9). The import answers 201 with those three rows rejected and seven kept; each flag names its `line`, `field` and reason, for example `{order_id: "O03", line: 4, field: "product_cost_inr", reason: "schema", detail: "product_cost_inr must not be negative on O03 — row excluded.", action: "rejected"}`.

Optional order columns for Pulse: `payment_type` (`cod`\|`prepaid`; header aliases `payment_method`, `payment_mode`), `customer_id` (alias `customer`) and `units` (whole number, at least 1; 1 when missing; aliases `qty`, `quantity`). Without them, the payment and repeat-customer views return `{not_in_file: true}`.

## Unit economics (margins)

`api/src/engine/margins.ts` is a pure aggregation of the computed orders (no rule of its own). Only orders whose contribution is known are counted; `partial` is true when unknown orders were left out.

```ts
interface Margins {
  net_revenue_inr: number;      // revenue − refunds = the engine's net sales (gross − discount − refund)
  net_product_cost_inr: number; // product cost − recovered product cost, subtracted once
  shipping_inr: number;
  payment_fee_inr: number;
  return_cost_inr: number;      // return shipping and inspection; counted with shipping in CM2
  handling_inr: number;
  ads_inr: number;              // allocated ads (allocate) or channel spend (channel); never both
  contribution_inr: number | null;
  cm1_pct: number | null;       // (net revenue − net product cost) ÷ net revenue
  cm2_pct: number | null;       // (net revenue − net product cost − shipping − return cost − payment fees − handling) ÷ net revenue
  cm3_pct: number | null;       // contribution ÷ net revenue
  orders_counted: number;
  unknown_left_out: number;
  partial: boolean;
}
```

Percentages have 2 decimals and are `null` when net revenue is 0 or the contribution is unknown. The parts always add up: `net_revenue − net_product_cost − shipping − payment_fee − return_cost − handling − ads = contribution_inr`, which equals the reconciled contribution in both modes. Return cost is counted in CM2 with outbound shipping, so CM2 − CM3 is ads only and CM3 is exactly contribution ÷ net revenue.

- Analysis responses: `margins` for the period; each `groups.channel[]` row has `margins` with its channel spend as ads in channel mode; each `groups.product[]` row has `margins` before channel spend in channel mode (as the product table), so Σ product contribution − `product_unallocated_spend_inr` = the total.
- Scenario responses: `margins: {baseline, scenario}`.
- The estimated net margin, (contribution − fixed costs) ÷ net revenue, is computed in the UI; at fixed costs 0 it equals CM3.

| Data | Net revenue | CM1 | CM2 | CM3 |
|---|---|---|---|---|
| Worked order | 800 | 50% | 41.25% | 28.75% (230 ÷ 800) |
| C21 fixture (both modes) | 14,400 | 54.17% (7,800 ÷ 14,400) | 41.67% | 41.67% (6,000 ÷ 14,400) |
| Extended sample (both modes, partial: 26 of 27 counted) | 19,900 | 51.01% | 37.9% | 35.44% (7,053 ÷ 19,900) |

## Checks

`GET /checks` keeps every earlier field and adds the working the checks screen shows.

- `check1.lines`: the six worked-order lines `[{key, label, kind, amount_inr, running_total_inr, note?}]`. Keys and values: `revenue` 1,000 → 1,000; `refund` −200 → 800; `net_product_cost` −400 → 400 (after recovery, subtracted once); `shipping` −50 → 350; `ads` −100 → 250; `handling` −20 → 230. There is no payment-fee line.
- `check2.rows`: 12 rows `[{dataset: "fixture"|"extended", attribution: "allocate"|"channel", sum: "orders"|"channels"|"products", label: "Σ orders"|"Σ channels"|"Σ products", total_inr, expected_total_inr, difference_inr, pass}]`. `difference_inr = total_inr − expected_total_inr` (6,000 and 7,053 from `data/expected.json`), 0 on every row.
- `check2.conflict`: `{label, dataset: "extended", request: {method: "POST", path: "/api/v1/datasets/:id/analyses", body: {attribution: "allocate", channel_spend: {web: 250}}}, expected_status: 409, actual_status, code, message, pass}`. It runs the analysis route's own request handling in-process (not over HTTP) and records the status the error maps to; it passes only because the engine refuses (409 `attribution_conflict`). `check2.pass` now also requires it.
- `check3.assumption_control`: `{endpoint, parameter: "return_rate_pct", min_pct: 0, max_pct: 100, observed_return_rate_pct: 20, default_return_rate_pct: 0, label_changing_values_pct: [0, 1, 2], label_changing_ranges: [{from_pct: 0, to_pct: 2}], note, at_default}`, where `at_default` is the missing-refund response below at the default rate. The recovery-based check 3 (`before`, `after_recovery_50`, `pass`) is unchanged.
- `check4`: `{net_revenue_inr: 800, cm1_pct: 50, cm2_pct: 41.25, cm3_pct: 28.75, net_margin_pct_at_zero_fixed_costs: 28.75, contribution_inr: 230, expected, margins, formulas: {net_revenue, net_product_cost, cm1, cm2, cm3, net_margin}, working: {net_revenue: "1,000 − 200 = 800", cm1: "(800 − 400) ÷ 800 = 50%", cm2: "(800 − 400 − 50 − 0 − 20) ÷ 800 = 41.25%", cm3: "230 ÷ 800 = 28.75%", net_margin: "(230 − 0) ÷ 800 = 28.75%"}, pass}`. The worked order runs through the engine's order computation (fee 0) and the margins aggregation; `pass` also requires its contribution to equal check 1's 230.

`GET /checks/missing-refund?return_rate_pct=X` answers:

```json
{ "dataset": "null_refund", "unknown_order": "O05", "status": "unknown", "contribution_inr": null,
  "total_inr": 6180, "total_label": "partial (1 unknown)", "observed_return_rate_pct": 20, "return_rate_pct": 0,
  "label": "Scenario: assumes 0% returns",
  "before": { "intervention": "charge_return_shipping", "label": "Charge return shipping", "expected_delta_inr": 150, "confidence": "unknown" },
  "after": { "intervention": "none", "label": "No change", "expected_delta_inr": 0, "confidence": "low" },
  "changed": true, "scenario_total_inr": 8400, "scenario_unknown": 0,
  "assumptions": ["Return rate 0%: 4 returned orders (O05, O10, O15, O20) treated as kept."],
  "engine_version": "1.0.0", "label_changing_values_pct": [0, 1, 2] }
```

Which rates change the label: only 0, 1 and 2% (any X below 2.5%). At those rates the 20 orders round to 0 returns, so every return becomes a kept order, no return lever is left, and the recommendation becomes "No change". From 2.5% to 100% it stays "Charge return shipping"; only the amount (₹50 per known return: ₹150 at 20%, ₹250 at 30%) and the confidence change. Return shipping (₹50 a return) always beats lifting recovery from 87.5% to 90% (₹10 a return), and discounts (10%) are under the 15% cap. A UI control can offer 0% ("assume no returns") as the label-changing value next to the observed 20%.

## Languages

`?lang=en|hi|te` (or `Accept-Language`; `?lang=` wins; default `en`) picks the language of template text: leak `why`, the recommendation's `why`, `test_30d_draft` and `stop_rule_draft`, the test plan and narration. Responses that honour it carry `lang` and `Vary: Accept-Language`. The engine stores English; other languages re-render the same templates from the same inputs, so every number is identical (`tests/api-i18n.test.ts`). Not translated: labels from the engine (`label`, `rule`, leak `label`, `labels[]`, assumption notes), `/checks`, field names and ids.

- Templates: `api/src/ai/templates/{en,hi,te}/*.hbs` (20 files each, the same names in every language) and `labels.json` (candidate names and one-line descriptions). Numbers are Handlebars variables filled after the language is chosen.
- The compiled API (`dist/`) has no `.hbs` files and reads `api/src/ai/templates/bundle.ts`, generated from them. After editing a template run `node api/src/ai/templates/build-bundle.mjs`; a test fails while the two differ.
- With Gemini on, the user message starts with "Reply in English|Hindi|Telugu." The number guard is unchanged and also rejects Devanagari or Telugu digits (`native_digits`) and the Hindi and Telugu words for profit or margin.
- `GET /i18n/labels?lang=te` example item: `{intervention: "cap_discount", label: "డిస్కౌంట్‌కు పరిమితి", description: "డిస్కౌంట్‌ను స్థూల అమ్మకంలో 15%కి పరిమితం చేయండి."}`.

## Decision file

`GET /decisions/:id/export?format=json` downloads `decision-<id>.json` (`Content-Disposition: attachment; filename="decision-<id>.json"`). Sample from the extended sample: `docs/sample_decision.json`.

```json
{
  "format": "profyn-decision/1",
  "decision_id": "…", "analysis_id": "…", "owner": "Operations lead",
  "date": "2026-10-18", "saved_at": "2026-10-18T00:36:46.245Z",
  "intervention": "raise_recovery_via_inspection", "intervention_label": "Raise recovery via inspection", "confidence": "low",
  "expected_impact_inr": 1000,
  "starting_state": { "totals": { "…": "Totals" }, "mode": "allocate", "period_end": "2026-09-30", "engine_version": "1.0.0",
                      "dataset_source": "extended", "margins": { "…": "Margins" }, "fixed_costs_inr": 3000, "net_margin_pct_estimated": 20.37 },
  "scenario": { "scenario_id": "…", "changed": "recovery_pct", "override": { "recovery_pct": 50 }, "assume_unknown_refund": true,
                "baseline_contribution_inr": 7053, "scenario_contribution_inr": 6197, "delta_inr": -856, "notes": ["…"] },
  "check_in_30_days": { "metric": "recovery_pct", "metric_label": "Average recovered stock value on returns, % of product cost",
                        "unit": "pct", "direction": "at_least", "baseline_value": 71.4, "baseline_source": "observed", "target_value": 90,
                        "date": "2026-11-17", "contribution_target_inr": 7197, "contribution_target_basis": "scenario" },
  "assumptions": [
    { "key": "recovery_pct", "value": 50, "source": "scenario_override", "label": "…" },
    { "key": "assume_unknown_refund", "value": true, "source": "scenario_toggle", "label": "…" },
    { "key": "handling_default_inr", "value": 0, "source": "config_default", "label": "Handling ₹ 0 per order on 20 orders whose row has none (estimate)" },
    { "key": "fixed_costs_inr", "value": 3000, "source": "user_input", "label": "…" }
  ],
  "test_30d": "…", "stop_rule": "…", "notes": "…",
  "labels": ["Operational contribution, not statutory net profit.", "Attribution is allocation, not causation."],
  "snapshot": { "…": "the server's assumption snapshot" }, "evidence": { "…": "totals, reconciliation, leaks, observed, checks" }
}
```

- `scenario` is `null` for a baseline decision; `override` holds the one changed input.
- `date` is the saved date; `check_in_30_days.date` is that date + 30 days.
- `check_in_30_days.metric` follows the rule chosen: `recovery_pct` (at least 90), `return_cost_paid_per_return_inr` (at most 0), `max_discount_pct_of_gross` (at most 15), `handling_not_in_price_per_order_inr` (at most 0), otherwise `contribution_inr` (at least the target). `baseline_value` is today's observed value. `contribution_target_inr` = the contribution of the state the impact was computed on (the scenario's when there is one) + `expected_impact_inr`.
- `assumptions[]` lists every assumed input, `{key, value, source: "scenario_override"|"scenario_toggle"|"config_default"|"user_input", label}`: the override, `assume_unknown_refund`, the handling default when any order used it, and `fixed_costs_inr` when it was sent with the decision.
- Records saved before the export existed still export, with `margins: null` and a contribution-only check-in.

## Corrections

How a flagged row is fixed, with no new rule: the change is applied, the same validation (`validateRows`) re-runs over every kept row and every rejected raw row with the period end of the original, and the result is saved as a new dataset version (`supersedes: <old id>`). The old version is never modified; sample files are never touched.

- `POST /datasets` now keeps the raw rows it rejected on the dataset: `rejected_rows: [{line, file?, order_id: string | null, raw}]` (at most 1,000; `raw` is the row as read, e.g. `"gross_inr": "one thousand"`). An append (`append_to`) carries the earlier ones over. Large ones are stored with the rows in object storage.
- The dataset summary (POST and GET `/datasets/:id`, and the correction response) also has `corrections: Correction[]`, `corrected_order_ids: string[]` and, for a later version, `supersedes`.

`PATCH /api/v1/datasets/:id/rows`

```json
{ "order_id": "O05", "changes": { "refund_inr": 900 }, "note": "Refund confirmed in the gateway report." }
{ "line": 9, "file": "sep.csv", "changes": { "date": "2026-09-09" } }
```

- Target: a kept row by `order_id`; else a rejected row by `order_id`; else a rejected row by `line` (plus `file` when several files were merged). `line` is the row's line in its file, as in the flags.
- `changes`: one or more C21 fields (any except `order_id`); `null` means unknown. Each value is checked by the schema first. When `gross_inr`, `discount_inr` or `refund_inr` changes, a stated `net_sales_inr` is cleared (the engine derives it).
- 201 response: the dataset summary of the new version plus `corrections_added` (this request's entries), `still_flagged` (the flags still on that row; `[]` when it is clean) and `persisted`. The new version is owned by the caller's account (`guest` without a token), also when the original was a shared sample.
- `Correction`: `{order_id: string | null, line: number | null, file?, field, from, to, at: ISO time, by: account id or "guest", note?}`. One entry per changed field; each new version carries all earlier corrections, oldest first.
- Errors: 422 `schema_invalid` with `path: "changes.<field>"` and the reason (`"refund_inr must not be negative."`, or the validation detail such as `refund_inr is greater than gross_inr − discount_inr …`) when the new value is invalid; nothing is saved. 422 for `order_id` in `changes`, an unknown field or no changes. 404 when the dataset is not visible to the caller or the row is not found.
- A row may stay rejected for another field (`still_flagged` names it) and can be fixed with a further PATCH on the new version.
- Analyse the new version with `POST /datasets/<new id>/analyses`.

## Sign-in

Sign-in is optional (Amazon Cognito, `api/src/auth.ts`). It is off unless `COGNITO_POOL_ID`, `COGNITO_CLIENT_ID` and `COGNITO_DOMAIN` are all set. When it is off, an `Authorization` header is ignored and the API behaves as it did before sign-in (decisions saved as usual, `workspace: "shared"`).

When it is on:

- Send `Authorization: Bearer <id token>`. A valid token scopes datasets, analyses and decisions to that account; another account's records answer 404 `not_found`.
- No token: the caller is a guest in the demo workspace. Guest datasets, analyses and decisions are saved like any other, under account `guest` (decision response `workspace: "demo"`, `persisted: true` when Mongo is connected). Lists stay scoped: a signed-in user never lists guest decisions, and a guest never lists an account's.
- An invalid or expired token is 401 `unauthorized`. A missing token is never blocked.
- `/health`, `/checks`, `/worked-order`, `/samples`, `/template.csv` and the web app's deep links work without a login.

## Pulse

Owner analytics over the same reconciled orders as the ledger (`api/src/engine/pulse.ts`). Read-only; each view is cached per analysis. Contribution is after ads in both attribution modes, so monthly and product totals equal `totals.contribution_inr`.

| View | Response fields |
|---|---|
| `overview` | `month, months[], headline, previous, deltas: {orders_pct, net_sales_pct, contribution_pct, return_pct_pts}, best, worst, actions[≤3]` — best and worst by net sales, contribution and contribution per order; each action is `{title, detail, recoverable_inr, lever, overrides?}`, and `overrides` pre-fills a scenario |
| `months` | `months: [{month, orders, unknown, gross_inr, net_sales_inr, contribution_inr, contribution_pct, return_pct, discount_depth_pct, aov_inr}]` |
| `products` | `products: [{product_id, units, orders, net_sales_inr, contribution_inr, contribution_per_unit_inr, return_pct, discount_depth_pct, shipping_pct, rank_units, rank_net_sales, rank_contribution, label: "push"\|"fix"\|"niche"\|"review", lever, note}]` |
| `channels` | `attribution, channels: [{channel, orders, net_sales_inr, contribution_inr, return_pct, ads_inr, ads_share_pct}], payments: {rows, cod_vs_prepaid_return_ratio} \| {not_in_file: true}` |
| `leaks` | `causes[], months: [{month, by_cause, total_lost_inr, unknown_orders}]` |
| `insights` | `discount_bands[], negative_from_discount_band, order_value_bands[], repeat: {customers, repeat_customers, repeat_rate_pct, contribution_per_order_first_inr, contribution_per_order_repeat_inr} \| {not_in_file: true}` |

## Error body (Blueprint §16.1)

```json
{ "error": { "code": "schema_invalid", "message": "product_cost_inr is missing from the CSV header.", "path": "product_cost_inr", "hint": "Add the column product_cost_inr in the C21 schema.", "issues": [{ "path": "product_cost_inr", "message": "column is missing" }] } }
```

| HTTP | code | When |
|---|---|---|
| 401 | `unauthorized` | sign-in on and the Bearer token is invalid, expired or malformed |
| 413 | `file_too_large` | over 5 MB or 10,000 rows |
| 415 | `unsupported_type` | not JSON or CSV |
| 422 | `schema_invalid` | missing or mistyped field; `path` names it |
| 422 | `no_valid_rows` | every row rejected; `issues` lists each |
| 422 | `override_invalid` | scenario with zero or several overrides |
| 404 | `not_found` | unknown dataset, analysis, scenario, decision, order or Pulse view; or a record of another account |
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

## v2 AI endpoints

The engine computes every number; the model (Gemini `gemini-2.5-flash`, JSON mode, 6 s timeout, cached by input hash) may only reword a template that is already correct. Every AI text passes the number-grounding guard: any figure that is not in the engine JSON it was given is a rejection, and the template is used instead. Every text carries `source: "ai" | "template"`. With `AI_DISABLED=1` or no `GEMINI_API_KEY` everything works with the deterministic templates (English, Hindi, Telugu).

**AI switch, per request.** Templates only when the request has `X-Profyn-AI: off`, or the signed-in user's `consent.ai` is `false`. With no stated consent, AI is on only for demo data (a built-in sample, or a file whose rows are all labelled `synthetic`); uploaded customer data needs `consent.ai === true`. The same switch applies to `POST /analyses/{id}/narrate`.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/datasets/{id}/autopilot` | `{attribution?, lang?}` (also `config`, `channel_spend`, `period_end` as for analyses) | 201 autopilot document |
| GET | `/autopilot/{id}` | | the same document |
| GET | `/autopilot/{id}/events` | | `text/event-stream`: `stage` events, then `done` |
| POST | `/autopilot/{id}/accept` | `{rank: 1-3, owner?}` | 201, the body `POST /analyses/{id}/decisions` returns |
| POST | `/analyses/{id}/advisor` | `{cause, lang?}` | Fix Advisor for one leak cause |
| POST | `/analyses/{id}/ask` | `{question, lang?}` | Ask Profyn answer with its tool call |
| GET | `/analyses/{id}/digest` | `?lang=` | Monthly digest, four sections |
| GET | `/ai/status` | `?dataset_id=` (optional) | AI transparency: model, counters, fields sent |

`lang` in a body wins over `?lang=` and `Accept-Language`; default `en`.

### Autopilot (`POST /datasets/{id}/autopilot`)

One job: analyse (persisted exactly as `POST /datasets/{id}/analyses`, so `analysis_id` works everywhere) → leaks → the four engine candidate scenarios → margins → Pulse. Numbers are filled before the response; explanations follow. A bad body or an attribution conflict is refused (422 / 409) before anything is stored.

```json
{
  "autopilot_id": "…", "dataset_id": "…", "analysis_id": "…",
  "status": "running | done | error",
  "stages": { "analysis": "done", "leaks": "done", "scenarios": "done", "margins": "done", "pulse": "done", "explanations": "pending | done | error" },
  "headline": { "contribution_inr": 7053, "net_sales_inr": 19900, "orders": 27, "unknown_orders": 1, "partial": true, "margins": { "…": "Margins" } },
  "top_leaks": [{ "cause": "full_return_partial_recovery", "label": "Full return, partial recovery", "orders": 5, "inr_at_stake": 1384 }],
  "actions": [{
    "rank": 1, "candidate_id": "raise_recovery_via_inspection", "intervention": "raise_recovery_via_inspection",
    "label": "Raise recovery via inspection", "overrides": { "recovery_pct": 90 }, "expected_delta_inr": 390,
    "confidence": "unknown", "driving_orders": 5,
    "explanation": { "text": "Returns currently recover 71.4% of product cost. …", "source": "template" },
    "decision_draft": { "intervention": "raise_recovery_via_inspection", "expected_delta_inr": 390, "test_30d": "…", "stop_rule": "…" }
  }],
  "pulse": { "month": "2026-09", "headline": { "…": "…" }, "deltas": null, "months_compared": 1 },
  "accepted": [{ "rank": 2, "decision_id": "…" }],
  "lang": "en", "created_at": "…"
}
```

- `actions` are exactly the top three engine candidates by expected ₹ delta (ties keep the engine order), including a candidate whose delta is 0 or negative (its explanation then says it does not improve contribution).
- `confidence`: the recommended candidate keeps the engine's confidence; others follow the engine rule (`unknown` when any order is unknown, `low` under 5 driving orders or no gain, else `high`). Accept records the same confidence on the decision.
- `overrides`: the single scenario override that expresses the change (only inspection → `recovery_pct: 90`); `null` when no override does. The expected delta is always the engine's candidate evaluation.
- Fields beyond the v2 contract: `driving_orders`, `pulse`, `accepted`, `lang`, `error` (on failure).
- Stored in Mongo `autopilots` (memory fallback), scoped by account like analyses.

**Events.** `GET /autopilot/{id}/events` sends `event: stage` with `{"stage","status"}` for each stage, then `event: done` with the full document, and closes. A finished run sends `done` at once. Headers: `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no` (no compression or proxy buffering).

**Accept.** `POST /autopilot/{id}/accept {rank, owner?}` saves the action's decision draft through the decisions code path (starting state, expected impact, 30-day check-in; `owner` defaults to `"Owner"`), with `assumptions.client_notes = {source: "autopilot", autopilot_id, rank, candidate_id, explanation_source}`. 422 for a rank the run does not have.

### Fix Advisor (`POST /analyses/{id}/advisor`)

`cause` is a leak cause the engine uses: `full_return_partial_recovery`, `refund_unknown`, `fees_exceed_margin`, `discount_exceeds_margin`, `other_negative` (422 otherwise; 404 when this analysis has no such leak).

```json
{
  "analysis_id": "…", "cause": "full_return_partial_recovery", "label": "Full return, partial recovery",
  "summary": { "text": "5 orders were refunded in full and only ₹ 1,500 of ₹ 2,100 product cost came back as stock. …", "source": "template" },
  "facts": { "orders": 5, "inr_at_stake": 1384, "example_ids": ["O05", "O10", "O15"], "product_cost_inr": 2100, "recovered_inr": 1500, "refund_inr": 4700, "return_cost_inr": 280 },
  "interventions": [
    { "candidate_id": "raise_recovery_via_inspection", "intervention": "raise_recovery_via_inspection", "label": "Raise recovery via inspection", "overrides": { "recovery_pct": 90 }, "expected_delta_inr": 390, "confidence": "unknown" },
    { "candidate_id": "charge_return_shipping", "intervention": "charge_return_shipping", "label": "Charge return shipping", "overrides": null, "expected_delta_inr": 280, "confidence": "unknown" }
  ],
  "test_30d": { "text": "…", "source": "template" },
  "stop_rule": { "text": "…", "source": "template" },
  "lang": "en"
}
```

Interventions by cause (2–3, filled with the best remaining candidates by delta): full return → inspection, charge return shipping; discount → cap discount; fees → add handling to price + `shipping_change` (scenario `shipping_inr` = 90% of the observed average shipping, priced by `scenarioFor`); refund unknown → `record_facts` (no ₹ estimate, confidence `unknown`) + `assume_unknown_refund` (scenario `{assume_unknown_refund: true}`); other → the best three candidates. `facts` adds per-cause input totals (`product_cost_inr`, `recovered_inr`, `refund_inr`, `return_cost_inr`; `discount_inr`, `gross_inr`; `shipping_inr`, `payment_fee_inr`; or `missing_facts` counts). The 30-day test and stop rule are for the first intervention.

### Ask Profyn (`POST /analyses/{id}/ask`)

Five read-only tools over the stored analysis: `leaks {cause?, month?}`, `pulse.months {month?}`, `pulse.products {month?, product?, order?: lowest_contribution|highest_contribution|net_sales}`, `pulse.channels {channel?}`, `scenario.run {override + value | policy}` or `{intervention}` (one override, or one engine candidate). With AI, Gemini function calling picks the tool (an invalid call falls back to the keyword router), the API runs it, and the model phrases the answer from the tool JSON only. Without AI, a keyword router (English, Hindi, Telugu) picks the tool and a template answers.

```json
{
  "answer": "In 2026-09, P2 lost most: −₹ 435 contribution on 64 orders.",
  "source": "ai | template | table",
  "tool": { "name": "pulse.products", "args": { "month": "2026-09", "order": "lowest_contribution" } },
  "result": { "month": "2026-09", "order": "lowest_contribution", "products": ["…top 5 rows…"], "focus": null, "total_products": 6 },
  "link": { "route": "ledger", "params": { "product": "P2", "month": "2026-09" } },
  "rejected": false,
  "lang": "en"
}
```

Guard: every figure in the model's answer must appear in the tool result (or its arguments or the question). Otherwise `answer: null`, `source: "table"`, `rejected: true`, `message: "AI could not phrase this safely"` (in the language) and the UI shows `result` as a table. `link.route` is `ledger` (with `cause`, `channel`, `product`, `month` filters), `leaks`, `pulse` or `scenario`.

### Monthly digest (`GET /analyses/{id}/digest?lang=`)

```json
{
  "analysis_id": "…",
  "sections": [
    { "key": "changed", "title": "What changed", "text": "In 2026-09, 240 orders brought ₹ 2,86,984 net sales and ₹ 30,550 contribution, against ₹ 56,418 in 2026-08.", "source": "template" },
    { "key": "leaked", "title": "Where money leaked", "text": "…", "source": "template" },
    { "key": "decided", "title": "What was decided", "text": "…", "source": "template" },
    { "key": "check", "title": "What to check in 30 days", "text": "…", "source": "template" }
  ],
  "source": "template",
  "badge": "Summary · numbers from the engine",
  "lang": "en"
}
```

Built from the Pulse overview (latest month against the one before), the two largest leaks, the decisions saved on this analysis, and the latest decision's 30-day check-in (else the recommendation's 30-day test). `source` is `ai` when any section is AI text; `badge` is then `"AI summary · numbers from the engine"`. No email is sent.

### AI status (`GET /ai/status`)

```json
{
  "enabled": false, "model": "gemini-2.5-flash", "provider": "Gemini",
  "region_note": "Orders, analyses and decisions are stored in AWS ap-south-1 (Mumbai). …",
  "calls": 0, "accepted": 0, "rejected": 0, "failed": 0,
  "by_feature": { "narration": { "calls": 0, "accepted": 0, "rejected": 0, "failed": 0 }, "autopilot": {}, "advisor": {}, "ask": {}, "digest": {} },
  "fields_sent": { "narration": ["cause", "count", "lost_inr", "…"], "autopilot": ["…"], "advisor": ["…"], "ask": ["…"], "digest": ["…"] },
  "all_time": null,
  "switch": { "header": null, "consent": null, "default_policy": "AI is on only for demo data …" },
  "policy": { "allowed": true, "reason": "demo_data" }
}
```

`calls` counts model calls; `accepted` / `rejected` count AI texts the guard passed or refused; `failed` counts timeouts and errors (template used). Counters are in memory since start; `all_time` is the Mongo counter document (`ai_counters`) when a database is connected. `policy` appears with `?dataset_id=` and is one of `disabled`, `switched_off`, `consent_off`, `consent_on`, `demo_data`, `customer_data`. `fields_sent` lists exactly which fields each feature sends: aggregates only (counts, ₹ totals, labels, order and product IDs), never a raw order row.

## v2 platform endpoints

Column mapping, Google/GitHub sign-in, the owner's account (audit log, export, delete), localized errors and the Shopify connector.
Code: `api/src/ingest/mapper.ts`, `api/src/auth-oauth.ts`, `api/src/routes/{import,auth,account}.ts`, `api/src/audit.ts`, `api/src/i18n/`. Trust summary: [docs/TRUST.md](TRUST.md).

### Import mapping

| Method and path | Request | Response | Errors |
|---|---|---|---|
| `GET /import/profiles` | — | `[{id, label, marketplace, fields_mapped: string[], notes: string[]}]` for `shopify_orders`, `amazon_settlement`, `flipkart_orders`, `myntra_orders`, `razorpay_payments`, `shiprocket_shipments` | — |
| `POST /import/map` | `{headers: string[], sample_rows?: (object \| array)[], profile?}` (≤ 50 sample rows) | `{profile: string\|null, source: "profile"\|"saved"\|"alias"\|"ai", mapping: {<schema field>: column\|null}, confidence: {<field>: 0–1}, unmapped_required: string[], saved: boolean, header_signature, notes: string[]}` | 422 (`profile` unknown, `headers` missing) |
| `POST /import/mappings` | `{headers or header_signature, mapping: {<field>: column\|null}, profile?}` | 201 `{header_signature, mapping, profile, saved: true, workspace}` — saved for the account (guests: the shared demo workspace) | 422 (field outside the schema, column not in `headers`) |

- **Order of evidence** for `/import/map`: an explicit `profile` → the account's saved mapping for this header signature (same columns, any order or case) → a profile recognised from its tell-tale headers (≥ 60 % present) → template names and the column-alias table → the AI. `saved` says whether a saved mapping exists for these headers.
- `mapping` lists every schema field. A field no column holds is `null`: unknown, never zero. Product cost is in none of the six exports, so it is always in `unmapped_required` until the owner maps a column.
- **AI** is used only when it is configured, not switched off (`X-Profyn-AI: off`), and the caller has `consent.ai: true` (uploaded data). It receives the header names and each column's masked shape — type, size band (`hundreds`, `thousands`, `lakhs`…), date format, text length and shape — never a value from the file. Each attempt is written to the audit log (`ai_call`, `fields_sent: ["headers", "column_types"]`). AI-filled fields have confidence 0.6.
- **Profiles** (`api/src/ingest/profiles/*.json`): `{id, label, marketplace, match_headers, map: {field: column | [candidates]}, transforms?, constants?, filter?, group_by?, sum_columns?, pivot?, notes}`. Shopify line items merge by `Name`; Amazon settlement amount rows pivot by `order-id` (tab-separated `.txt` accepted); Razorpay keeps captured/refunded payments; e-mail and phone columns are hashed into `customer_id`.

`POST /datasets` also takes `mapping` (object, or JSON text in a multipart field) and `profile`, next to the existing body: multipart fields `mapping`/`profile` with `file` (`.csv`, `.tsv`, `.txt`, `.json`); JSON `{records: {orders}} | {orders} | {rows}` plus `mapping`/`profile`; `text/csv` with `?profile=` and `?mapping=<JSON>`. The mapping is applied before validation; the owner's `mapping` overrides the profile field by field. The 201 response adds `mapped: {profile, mapping: boolean}`. Without `mapping` or `profile`, uploads behave exactly as before.

### Sign-in with Google or GitHub

| Method and path | Request | Response | Errors |
|---|---|---|---|
| `GET /auth/providers` | — | `{google: boolean, github: boolean, email: boolean}` (email = Cognito) | — |
| `GET /auth/google` · `GET /auth/github` | `?return=/app/…` (same-site path; anything else becomes `/app/`) | 302 to the provider; sets `profyn_oauth` (signed state, 10 minutes, `Path=/api/v1/auth`) | 404 `provider_disabled` |
| `GET /auth/{google,github}/callback` | `?code&state` from the provider | 302 to the return path with `Set-Cookie: profyn_session=<HS256 JWT>; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure` (not Secure for a localhost `PUBLIC_URL`). A refused or failed exchange returns to `<return>?auth_error=access_denied\|provider_error\|oauth_failed` | 400 `invalid_state` (missing, expired or mismatched state), 404 |
| `POST /auth/logout` | — | 204, clears `profyn_session` | — |
| `GET /me` | cookie or Bearer | `{user: {_id, sub, provider, email, name, avatar_url, locale, created_at, last_login_at, consent}, logins: [{at, provider, user_agent, ip_hash}] (last 20), consent: {ai, email_digest}, auth_enabled, workspace: "account"}` | 401 for a guest, with body `{error, user: null, auth_enabled, workspace: "demo"}` |
| `PATCH /me/consent` | `{ai?: boolean, email_digest?: boolean}` | `{consent}` | 401, 422 |

- The code is exchanged on the server (Google: `openid email profile`; GitHub: `read:user user:email`, primary verified e-mail). Redirect URI: `PUBLIC_URL + /api/v1/auth/{provider}/callback`.
- The session cookie and a Cognito Bearer token resolve to the same `req.user`: `{sub, email, provider, name, avatar_url, consent}`. `sub` is the account every record is saved under. Cognito users are recorded in `users` (provider `email`) on first sight. A tampered or expired cookie is cleared and the request continues as a guest. Consent defaults to `{ai: false, email_digest: false}`.
- Guests share one demo workspace (account `guest`), so signing in has no guest-owned records to move.
- Collections: `users {_id, provider, provider_id, email, name, avatar_url, locale, created_at, last_login_at, consent}`, `logins {user_id, provider, ip_hash (sha256 of ip + SESSION_SECRET), user_agent, at}`.

### Account (trust)

| Method and path | Request | Response | Errors |
|---|---|---|---|
| `GET /me/audit` | — | `[{at, kind, action, detail, data}]`, newest first (200 max). `kind`: `login`, `import`, `ai_call`, `decision`, `export`, `consent`, `mapping`, `connector_connected`, `connector_sync`, `connector_disconnected`; `detail` is one readable line, `data` the recorded fields | 401 |
| `GET /me/export` | — | JSON attachment `profyn-export-<date>.json`: `{exported_at, account, user, consent, logins, datasets (with rows), analyses, scenarios, decisions, column_mappings, autopilots, connectors (no tokens), audit}` | 401, 503 |
| `DELETE /me` | `{confirm: "DELETE"}` | 204; every record owned by the account, its uploads and stored bodies (`uploads/<dataset>-*`, `blobs/…`), mappings, sign-ins, audit log and user are deleted; the session cookie is cleared | 401, 422 (`path: "confirm"`), 503 |

AI features record calls with `audit.record(req, {kind: "ai_call", feature, model, fields_sent, accepted, reason?})` (field names only, never values). Guests keep no audit log.

`GET /health` adds `region`: `AWS_REGION` (default `ap-south-1`) when storage is S3, else `local`. Every response carries `Strict-Transport-Security: max-age=31536000; includeSubDomains` with the other helmet headers.

### Localized errors

Error `message`, `hint` and `issues[].message` follow `?lang=` or `Accept-Language` (`en`, `hi`, `te`; English by default and unchanged). Values inside a message (file names, ids, field names, numbers) are kept as written; a message without a translation stays in English. Translated responses carry `Content-Language`. Catalogues: `api/src/i18n/messages.{en,hi,te}.json`.

```json
{ "error": { "code": "schema_invalid", "message": "headers అవసరం", "path": "headers", "hint": "పేర్కొన్న ఫీల్డ్‌ను సరిచేసి మళ్లీ పంపండి.", "issues": [{ "path": "headers", "message": "అవసరం" }] } }
```

New error codes: 400 `invalid_state` (sign-in state), 404 `provider_disabled` (provider not configured).

### Shopify connector

Orders come straight from a Shopify store (GraphQL Admin API, version `SHOPIFY_API_VERSION`, default `2026-07`) and become a dataset through the same validation as an upload (`source: "shopify:<shop>"`; not demo data for the AI policy). Code: `api/src/connectors/{shopify,store}.ts`, `api/src/routes/connectors.ts`; tests `tests/shopify.test.ts`.

| Method and path | Request | Response | Errors |
|---|---|---|---|
| `POST /connectors/shopify/test` | `{shop, token}` | `{ok: true, shop: {name, domain, currency, plan?}, scopes: string[], orders_estimate?: number, currency_warning?}` (estimate = orders in the last 365 days) | 400 `invalid_shop` / `shop_not_found` ("Store not found — use your-store.myshopify.com"), 401 `shopify_unauthorized` ("Shopify rejected the access token"), 422 `missing_scope` ("Missing scope read_orders"), 422 `schema_invalid` (`token` missing), 502 `shopify_unavailable` |
| `POST /connectors/shopify/connect` | `{shop, token, since?: "YYYY-MM-DD" (default 365 days ago), assumptions?: {shipping_inr = 60, fee_pct = 2, return_cost_inr = 0, cod_fee_inr = 0}}` | 201: the `POST /datasets` body (`dataset_id, rows_in, rows_kept, rows_rejected, kept_ids, flags, …`) plus `orders_fetched, skipped, skipped_detail: {cancelled, test}, assumptions, currency_warning?, cost_hint?, truncated?, more?` and `connector: {provider: "shopify", shop, shop_name, currency, connected_at, last_sync_at, orders_imported, stored}` | as above; 422 `no_orders` (none since `since`), 422 `no_valid_rows` (every order rejected, e.g. no "Cost per item" in Shopify) |
| `POST /connectors/shopify/sync` | — | 201 as connect (a new version of the connector's dataset: `appended_to`, `supersedes`, `rows_added`, `rows_updated`, `duplicates_ignored`); 200 with `unchanged: true` when nothing changed | 404 `not_connected` (guest, or no connection), 401 `shopify_unauthorized` (token revoked or unreadable: connect again) |
| `GET /connectors` | — | `{connectors: [{provider, shop, shop_name, currency, connected_at, last_sync_at, orders_imported, dataset_id, assumptions}], shopify_oauth: boolean}`; guests get `connectors: []` | — |
| `DELETE /connectors/shopify` | — | 204; the stored token is deleted (datasets stay) | — |
| `GET /connectors/shopify/install` | `?shop=x.myshopify.com&return=/app/` | 302 to `https://{shop}/admin/oauth/authorize?client_id&scope=read_orders,read_products,read_inventory&redirect_uri={PUBLIC_URL}/api/v1/connectors/shopify/callback&state`; sets `profyn_shopify` (signed state, 10 minutes, `Path=/api/v1/connectors/shopify`). Guests: 302 `/login/` | 400 `invalid_shop`, 404 `provider_disabled` (no `SHOPIFY_CLIENT_ID`/`SHOPIFY_CLIENT_SECRET`) |
| `GET /connectors/shopify/callback` | from Shopify: `?code&hmac&shop&state&timestamp…` | Checks the HMAC (SHA-256 of the sorted other parameters with the client secret, constant-time compare), the store address and the state cookie; exchanges the code at `https://{shop}/admin/oauth/access_token`, stores the token for the signed-in owner, imports with the default assumptions and redirects to `<return>#/overview?connected=shopify` (on a failed import `…&shopify_error=<code>`; a failed exchange `#/overview?shopify_error=<code>`). Guests: 302 `/login/` | 400 `invalid_state` (bad HMAC, state or account), 400 `invalid_shop`, 404 |

**Store address (SSRF guard).** Only `^[a-z0-9][a-z0-9-]*\.myshopify\.com$` is called; a bare name (`your-store`) gets `.myshopify.com` added. URLs, other hosts, ports and paths are 400 `invalid_shop` before any request. Redirects are not followed.

**Token storage.** Signed-in owners: the token is stored AES-256-GCM encrypted (key `sha256(SESSION_SECRET + "shopify")`, random 12-byte IV) in the `connectors` collection (memory when no database), one per account; it is never returned or logged, and is removed by `DELETE /connectors/shopify` and `DELETE /me`. Guests (demo workspace) import once; nothing is stored (`stored: false`). A server without `SESSION_SECRET` stores nothing either. Audit events: `connector_connected`, `connector_sync`, `connector_disconnected`.

**Mapping** (one row per order; `mapShopifyOrder`): `order_id` = name without `#` prefixed `SH` (`#1001` → `SH1001`); `date` = `createdAt` in IST; `discount_inr` = total discounts; `gross_inr` = subtotal (after discounts) + discounts; `refund_inr` = total refunded (0 with no refunds; capped at gross − discount, shipping refunds excluded); `net_sales_inr` = null (the engine derives it); `product_cost_inr` = Σ quantity × the variant's "Cost per item", **null when any line has no cost** (row rejected and listed for correction: unknown, never zero); `returned` = any refund line restocked as `RETURN` (or `LEGACY_RESTOCK`), or a full refund with refund lines; `recovered_product_cost_inr` = Σ restocked quantity × unit cost (0 when nothing returned; null when returned but a cost is unknown); `shipping_inr` = `assumptions.shipping_inr`; `payment_fee_inr` = round((subtotal + shipping charged) × `fee_pct` / 100) + `cod_fee_inr` for COD; `return_cost_inr` = `return_cost_inr` when returned, else 0; `payment_type` from the gateway names (COD / prepaid / null); `channel` from `sourceName` (`web`, `pos`, `shopify_draft_order` → `draft`, others lowercased); `product_id` = first line's SKU or product handle; `units` = Σ quantity; `refund_date` = first refund (IST); `note: "shopify; shipping/fee assumed"`. Test and cancelled orders are skipped and counted. No customer fields are read. Amounts are the shop currency: a non-INR store gets `currency_warning`. Unit cost is Shopify's current "Cost per item", not the cost on the order date.

**Reading orders.** Orders are read oldest-update first (`sortKey: UPDATED_AT`, `query: "created_at:>=SINCE [updated_at:>=LAST]"`), 25 per page with up to 10 line items each (orders with more are re-read with 100), then unit costs per distinct variant (`nodes(ids:)`, 100 per call) and refund lines for refunded orders (10 per call). A query over Shopify's 1,000-point cost limit is retried with fewer nodes; throttling (`THROTTLED`, 429, 5xx) waits for the bucket (from `extensions.cost.throttleStatus`, or `Retry-After`) and retries up to 3 times. One import reads at most 20,000 orders and stops paginating after `SHOPIFY_IMPORT_BUDGET_MS` (default 25 000 ms) with `truncated: true`; the next sync continues from the last order read.

**Sync.** Reads orders updated since the last sync and adds them to the newest version of the connector's dataset through the `append_to` path: new orders are added, unchanged ones ignored as duplicates, and orders whose Shopify facts changed (refund, return, cost, discount) replace the saved row (`rows_updated`) unless the owner corrected that order. If the dataset is gone, everything since `since` is imported again.

**Getting a token (store owner).** Shopify admin → Settings → Apps and sales channels → Develop apps (or the Shopify Dev Dashboard for new apps) → Create an app → Configure Admin API scopes: `read_orders`, `read_products`, `read_inventory` (and `read_all_orders` for orders older than 60 days) → Install app → copy the Admin API access token (`shpat_…`, shown once) and paste it with the `your-store.myshopify.com` address. Product costs come from each variant's "Cost per item" (Products → product → Pricing).

**App install (optional).** For an app created in the Shopify Dev Dashboard set `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` (with `SESSION_SECRET` and `PUBLIC_URL`); `shopify_oauth` is then `true`. Add `{PUBLIC_URL}/api/v1/connectors/shopify/callback` as an allowed redirect URL in the app's configuration.

Environment: `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` (optional, app install), `SHOPIFY_API_VERSION` (default `2026-07`), `SHOPIFY_IMPORT_BUDGET_MS` (default `25000`), plus the existing `SESSION_SECRET` (token encryption) and `PUBLIC_URL` (redirect URI).

New error codes: 400 `invalid_shop`, 400 `shop_not_found`, 401 `shopify_unauthorized`, 422 `missing_scope`, 422 `no_orders`, 404 `not_connected`, 502 `shopify_unavailable`.
