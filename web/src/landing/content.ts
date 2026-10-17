// Landing copy. Every claim here maps to something the product does today; anything not built is labelled.
import { APP_PATH, BRAND } from '../brand';
import type { IconName } from './icons';

/** Deep links into the app open in demo mode on the sample data, so nothing is tied to an account. */
const demoPage = (route: string) => `${APP_PATH}?mode=demo#/${route}`;

export const HERO = {
  eyebrow: 'Profitability intelligence',
  lead: 'Know where your money goes. Know what to do next.',
  body: `Your sales tell you what came in. ${BRAND.name} works through every order — refunds, returns, shipping, fees and ads — so you understand what you kept, where profit may be leaking, and what deserves your attention next.`,
  ticks: ['CSV & JSON', 'No mandatory integrations', 'Drill down to the numbers'],
};

export const SOURCES: Array<{ label: string; icon: IconName }> = [
  { label: 'Shopify orders', icon: 'store' },
  { label: 'Marketplace reports', icon: 'bag' },
  { label: 'Meta / Google Ads', icon: 'megaphone' },
  { label: 'Courier & returns', icon: 'truck' },
  { label: 'Payment reports', icon: 'card' },
  { label: 'Your own CSV / JSON', icon: 'file' },
];

export const PROBLEMS: Array<{ title: string; lead: string; text: string }> = [
  {
    title: 'The vanity number',
    lead: 'Sales look healthy.',
    text: 'Net sales do not show what refunds, return shipping, payment fees and ads took back from each order.',
  },
  {
    title: 'Scattered costs',
    lead: 'Five files, no answer.',
    text: 'Orders, ads, courier, payments and returns sit in different exports, so nobody adds them up order by order.',
  },
  {
    title: 'Late discovery',
    lead: 'Problems hide in totals.',
    text: 'The product that sells the most can lose money on every return, and the monthly total will not tell you.',
  },
  {
    title: 'No next step',
    lead: 'Charts don’t make decisions.',
    text: 'Knowing a number fell does not say which one change to test first, or when to stop testing it.',
  },
];

export const STEPS: Array<{ title: string; text: string; icon: IconName; href: string }> = [
  {
    title: 'Import',
    text: 'Drop up to 12 CSV or JSON files. Every row is validated, and every rejected row says why.',
    icon: 'upload',
    href: demoPage('import'),
  },
  {
    title: 'Ledger',
    text: 'Refunds, recovery, shipping, fees and ads come off each order, reconciled to channels and products.',
    icon: 'table',
    href: demoPage('ledger?load=extended'),
  },
  {
    title: 'Leaks',
    text: 'Losing orders are grouped by cause, so the biggest rupee leak is the first one you see.',
    icon: 'search',
    href: demoPage('leaks?load=extended'),
  },
  {
    title: 'Scenario',
    text: 'Change exactly one assumption, such as return rate, recovery or shipping, and see the rupee effect.',
    icon: 'sliders',
    href: demoPage('scenario?load=extended'),
  },
  {
    title: 'Decision',
    text: 'Save the rule with a 30-day test, a stop rule and the numbers it was based on.',
    icon: 'clipboard',
    href: demoPage('decision?load=extended'),
  },
];

export const FEATURES: Array<{ tag: string; title: string; text: string; icon: IconName }> = [
  {
    tag: 'Core',
    title: 'Contribution at a glance',
    text: 'What every order left after refunds, recovery, shipping, fees and ads, rolled up by month, channel and product.',
    icon: 'activity',
  },
  {
    tag: 'Evidence',
    title: 'Leak board',
    text: 'Losing orders grouped by cause: full returns with partial recovery, discounts deeper than margin, fees above margin.',
    icon: 'search',
  },
  {
    tag: 'Model',
    title: 'What-if, one change at a time',
    text: 'Move one lever (return rate, recovery, shipping, refund policy or ads per order) and see the rupee effect before you commit.',
    icon: 'sliders',
  },
  {
    tag: 'Traceable',
    title: 'Order-level waterfall',
    text: 'Open any order and follow it from gross sales to contribution, with where each line came from.',
    icon: 'receipt',
  },
  {
    tag: 'Trust',
    title: 'Data-quality guardrails',
    text: 'A missing value is shown as unknown, never zero. Duplicates, late refunds and mismatches are flagged with the row and the reason.',
    icon: 'shield',
  },
  {
    tag: 'Analytics',
    title: 'Pulse owner analytics',
    text: 'Months compared, products by volume and contribution, channels and COD vs prepaid, leaks over time, and the top 3 actions in ₹.',
    icon: 'bar-chart',
  },
];

export type RoadmapStatus = 'Live' | 'Coming next' | 'Future direction';

export const ROADMAP: Array<{ title: string; text: string; status: RoadmapStatus; icon: IconName }> = [
  {
    title: 'Smart column mapping',
    text: 'Common column names are recognised through aliases (cogs, sku, gateway_fee and more), with a downloadable template.',
    status: 'Live',
    icon: 'columns',
  },
  {
    title: 'Monthly files, merged',
    text: 'Upload up to 12 files at once. They merge into one dataset, and orders already saved to your account are skipped.',
    status: 'Live',
    icon: 'files',
  },
  {
    title: 'Decision tracking',
    text: 'Each decision keeps its rule, a 30-day test, a stop rule and the assumptions it was based on.',
    status: 'Live',
    icon: 'clipboard',
  },
  {
    title: 'Ask Profyn',
    text: 'A chat copilot for questions about your own numbers, answered from the engine’s figures.',
    status: 'Coming next',
    icon: 'chat',
  },
  {
    title: 'Daily WhatsApp brief',
    text: 'Yesterday’s contribution and the leak worth a look, sent where you already read messages.',
    status: 'Future direction',
    icon: 'message',
  },
  {
    title: 'Connected data sources',
    text: 'Store and marketplace connectors, so the export step becomes optional.',
    status: 'Future direction',
    icon: 'plug',
  },
];

export const AUDIENCES: Array<{ title: string; text: string; icon: IconName }> = [
  {
    title: 'D2C & e-commerce founders',
    text: 'Brands doing 100 to 5,000 orders a month on their own store or marketplaces, usually without a finance team.',
    icon: 'store',
  },
  {
    title: 'Agencies & accountants',
    text: 'People who look after several brands and need numbers they can show their working for, order by order.',
    icon: 'briefcase',
  },
  {
    title: 'Growing small businesses',
    text: 'Sellers juggling COD, returns and ads, with a spreadsheet that no longer keeps up with the order count.',
    icon: 'trending-up',
  },
];

export const TRUST: Array<{ title: string; text: string; icon: IconName }> = [
  {
    title: 'Know what’s included',
    text: 'Every deduction is a named line: discount, refund, product cost after recovery, shipping, payment fee, return cost, handling and ads. It is operational contribution, not statutory net profit.',
    icon: 'layers',
  },
  {
    title: 'See data gaps',
    text: 'Unknown stays unknown. Totals are marked partial, any filled gap is a labelled assumption, and the validation report names the file, the row and the reason.',
    icon: 'alert',
  },
  {
    title: 'Trace every rupee',
    text: 'Σ orders = Σ channels = Σ products, under both ad-attribution modes. Figures come from a deterministic engine; optional AI only rewords text and is rejected if it adds a number.',
    icon: 'target',
  },
];

export interface Plan {
  name: string;
  monthly: number;
  orders: string;
  blurb: string;
  features: string[];
  popular?: boolean;
}

export const ANNUAL_DISCOUNT = 0.2;

/** Every plan gets every feature; plans differ by order volume, and Scale adds API access. */
const EVERY_PLAN = ['Ledger, leak board and Pulse', 'Scenarios and decision record', 'Up to 12 files merged per upload', 'Saved data and CSV export'];

export const PLANS: Plan[] = [
  {
    name: 'Starter',
    monthly: 999,
    orders: 'Up to 500 orders a month',
    blurb: 'For a brand finding its first leaks.',
    features: EVERY_PLAN,
  },
  {
    name: 'Growth',
    monthly: 2999,
    orders: 'Up to 3,000 orders a month',
    blurb: 'For a brand selling on several channels.',
    features: EVERY_PLAN,
    popular: true,
  },
  {
    name: 'Scale',
    monthly: 7999,
    orders: 'Up to 15,000 orders a month',
    blurb: 'For high-volume brands and their teams.',
    features: [...EVERY_PLAN, 'API access'],
  },
];

export const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Do I need to connect my store?',
    a: 'No. You start with the exports you already have, as CSV or JSON in our order template. There is nothing to install and nothing changes in your store. Live store connectors are a future direction, not something we offer today.',
  },
  {
    q: 'What files can I upload?',
    a: 'CSV or JSON in a fixed order schema, with a downloadable template and aliases for common column names. You can upload up to 12 files at once, for example one per month; they are merged into one dataset, and orders already saved to your account are skipped.',
  },
  {
    q: 'Why “contribution” and not “profit”?',
    a: 'Because that is what it measures: what each order leaves after refunds, recovery, shipping, fees and ads. Rent, salaries and tax are not in an order file, so this is operational contribution, not statutory net profit. It does not replace your books or your accountant.',
  },
  {
    q: 'What if my data has gaps?',
    a: 'A missing value is shown as unknown, never as zero. Totals that leave unknown orders out are marked partial, and the margin headline stays locked while a return lacks its refund or recovery fact. If you choose to fill a gap in a scenario, it is recorded as a labelled assumption.',
  },
  {
    q: 'How do I know the numbers are right?',
    a: 'Every order opens into a waterfall showing each line and where it came from, and the totals reconcile: the sum of orders equals the sum by channel and by product under both ad-attribution modes. A good first test is to run one month you already know and compare it line by line.',
  },
  {
    q: 'What does AI do, and what does it not do?',
    a: 'AI is optional and only rewords explanations of numbers the engine already computed. It never calculates, never fills a missing value and never decides. Any AI sentence containing a number that is not in the input is rejected and the plain text is shown instead. A chat copilot (Ask Profyn) is coming next and is not live.',
  },
  {
    q: 'Is my data safe?',
    a: 'In the demo you work on sample data and nothing is tied to an account. When you sign in, your uploads and decisions are saved to your account, and other accounts cannot read them. You can export to CSV at any time. No figure is sent to a model to be calculated.',
  },
  {
    q: 'What does the free trial include?',
    a: 'Fourteen days on your own CSV with every feature of the plan. Create an account, upload a month of orders and see your contribution before you decide anything.',
  },
];
