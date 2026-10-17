# Market: who else does this, what they miss, how Profyn sells

Profyn is a contribution-and-leak desk for Indian D2C brands: upload last month's orders, see what each order really earned after returns, fees, shipping, discounts and ads, and record the one change you will test. Tagline: **Know More. Earn Better.**

Status, stated plainly: no paying customers yet. Every number in the demo comes from the case fixture or from clearly labelled synthetic data (`data/C21_extended.json`, `data/demo_12m.json`).

## 1. Similar products and where they fall short

Competitor pricing and features are as published on their sites when we checked; they change often, so verify before quoting them in a pitch.

| Product | What it does well | Where it falls short for an Indian D2C founder |
|---|---|---|
| TrueProfit (Shopify app, from about $35/month) | Net profit per order with COGS, fees, shipping and ad spend; mobile app; per-SKU cost rules | Shopify only; a return is treated as a refund and recovered stock is ignored; a missing cost becomes zero; dashboards with no decision record |
| BeProfit | Profit tracking across Shopify, Amazon, WooCommerce and Wix | Needs store connectors; no scenario simulation; no control over how ad spend is attributed |
| Lifetimely by AMP (from about $149/month) | Daily P&L, LTV and cohort analysis, ad spend in one place | Priced for larger brands; ad spend is one unified view; no per-order handling of unknown costs; no COD or RTO lens |
| Triple Whale | Attribution first: first-party pixel, post-purchase surveys, summary dashboards | Attribution is the product and contribution is a by-product; dollar-first, enterprise pricing |
| GoKwik, Return Prime (India) | Checkout, RTO-risk prediction, returns management | Prevents RTO at checkout; does not compute order contribution or reconcile to finance totals |
| Delhivery RTO Predictor, Shiprocket analytics | Courier-side RTO prediction and shipping analytics | Logistics view only; no product cost, fees, discounts or decisions |
| Unicommerce and other OMS dashboards | Order and inventory operations at scale | Operational, not financial; no contribution per order |
| Spreadsheets (the real incumbent) | Free, trusted, flexible | Order-level costs are never applied; leaks stay invisible until the P&L; no audit trail |

## 2. What Profyn adds

| Feature | Why it matters |
|---|---|
| Refund and recovery rules before any headline | A return is netted once against recovered stock, and the headline stays hidden until the facts are complete, which is the product change the case asks for |
| Unknown is a value, not a zero | A missing refund or ad cost is labelled and the total is marked partial. A finance reviewer can trust that |
| Two attribution modes with a reconciliation proof | Ads are allocated per order or kept as channel spend, never both, and the totals balance either way (₹7,053 on the extended sample in both modes) |
| Scenario, then a decision record with a 30-day test | One change at a time, saved with its assumptions and a stop rule. Dashboards stop at the chart |
| Pulse owner analytics | Best and worst month, products to push or fix, channel and COD-vs-prepaid ranking, leaks over time and the top three actions in rupees, all from the same reconciled engine |
| CSV first, connectors later | Works on day one with exports from Shopify, WooCommerce, marketplaces or Tally, with no integration |
| India lens | COD vs prepaid, return cost per order, rupee grouping (₹1,23,456). None of the global tools above showed a COD-vs-prepaid view |
| Deterministic engine; AI only writes words | Every rupee can be reproduced. A model reply that adds a number is rejected |
| Proof built in | `/checks`, the checks panel and `make check` show the three case checks pass on the live site |

## 3. Go-to-market

| | |
|---|---|
| Segment | Indian D2C brands doing 100–5,000 orders a month on Shopify, WooCommerce or marketplaces, with no finance team. Also agencies and accountants who serve several such brands |
| Buyer and user | The founder-operator buys. The ops lead uses it weekly. The accountant reviews the decision log monthly |
| Pricing (first test) | **Free ₹0** up to 100 orders a month, no card · **Starter ₹999/month** up to 500 orders · **Growth ₹2,999/month** up to 3,000 orders · **Scale ₹7,999/month** up to 15,000 orders plus API access. Annual billing saves 20%. Paid plans start with a 14-day trial on your own orders. The free plan lets a founder see their own numbers before any sales call |
| Price position | Starter is below TrueProfit's entry price (about $35) and far below Lifetimely's (about $149) |
| First-customer path | Interview five founders about leakage → offer a free "sample order audit" on last month's CSV → show the leak board and one decision → convert to Starter |
| Pilot promise | Run alongside a finance-approved contribution report for one month. We make no claim of statutory profit. Data stays in the customer's account and can be exported at any time |
| Channels | D2C founder communities; accounting firms; Shopify and WooCommerce agencies in India; Fynd as a distribution partner for its brands |
| Proof we can show today | A deterministic engine with tests, the three case checks, the extended sample, the 12-month synthetic demo and the decision export. We make no claim of live revenue |

## 4. Questions an investor will ask

- **Why not a Shopify app?** Most of our segment sells on more than one channel, and many brands are COD-heavy. CSV first reaches all of them now; connectors come once usage shows which ones matter.
- **What stops a competitor copying this?** The rules: refund and recovery handling, unknown values kept unknown, and attribution that reconciles. These are tested, documented decisions (`docs/RULES.md`, `docs/adr/`) and not just a chart.
- **How do you know the numbers are right?** `make check` runs the case's three checks against any deployment, and the worked order (₹230) is reproduced in a test.
