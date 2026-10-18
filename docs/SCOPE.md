# Scope: what works now and what is planned

One table, kept honest. "Now" means it runs in this repository and on the live site today. "Planned" means it is designed for but not built. "Out of scope" means we chose not to build it, and say so on the slide. The app's Change log page (`#/changelog`) renders this file as it is, so the app and the docs cannot drift.

| Capability | Status | What that means today |
|---|---|---|
| CSV and JSON upload | **Now** | Import takes one file or up to 12 at once (for example one per month), merged into one dataset; every row is validated and every flag names its file and line. A downloadable CSV template and a column-alias table (cogs, sku, gateway_fee…) |
| Contribution engine | **Now** | Deterministic rules R1–R13 in `api/src/engine/`: net revenue = revenue − refund, net product cost = product cost − recovered, payment fee as its own line, late refunds as a prior-period adjustment. Unknown stays unknown, never ₹0 |
| Public checks | **Now** | `GET /api/v1/checks` and the Checks page (`#/checks`): worked order ₹230, Σ orders = Σ channels = Σ products in both attribution modes, unknown refund labelled, and margins on the worked order. No login |
| Pulse owner analytics | **Now** | Months, products, channels and payments, leaks over time and three ranked actions, from the same reconciled ledger. The 12-month demo brand is labelled synthetic |
| Monthly report | **Now** | `#/report?month=YYYY-MM`: unit economics, ledger totals with the late-refund adjustment, top leaks and saved decisions with their 30-day check date, printable to PDF from the browser |
| Sign-in | **Now** | Profyn's own login page on Amazon Cognito. A signed-in owner's uploads, analyses and decisions are saved under their account. The demo and the checks need no login |
| S3 storage | **Now** | With `S3_BUCKET` set (the live site), uploads and exports are written to a private S3 bucket. A local run without it writes them to `data/uploads` instead |
| Languages | **Now** | English, हिन्दी and తెలుగు for the app's labels; every rupee figure and every API response stays the same in all three |
| Shopify connector | Planned | Orders arrive by CSV export today; the importer's schema is the contract a connector would fill |
| Meta Ads connector | Planned | Ad spend comes from the order file (`ads_inr`) or channel totals today |
| Google Ads connector | Planned | As for Meta Ads |
| Shiprocket connector | Planned | Shipping and return cost come from the order file today |
| Razorpay connector | Planned | Payment fee and payment type come from the order file today |
| Causal attribution of advertising | Out of scope | Ads are allocated per order or deducted per channel, never both. Attribution is allocation, not causation |
| Statutory profit (P&L, GST, tax) | Out of scope | Profyn reports operational contribution. It is not statutory net profit and is not for filing |

Also out of scope for now: forecasting, multi-currency, and team workspaces with roles.
