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
