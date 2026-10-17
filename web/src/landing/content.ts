// Landing copy. Every claim here maps to something the product does today; anything not built is labelled.
import { APP_PATH, BRAND } from '../brand';
import type { IconName } from './icons';

/** Deep links into the app open in demo mode on the sample data, so nothing is tied to an account. */
const demoPage = (route: string) => `${APP_PATH}?mode=demo#/${route}`;

export const HERO = {
  eyebrow: 'Profitability intelligence',
  lead: 'Know where your money goes. Know what to do next.',
  body: `Your sales tell you what came in. ${BRAND.name} works through every order — refunds, returns, shipping, fees and ads — and shows what you kept, where profit leaks, and what to fix first.`,
  ticks: ['CSV & JSON, no integration', 'Unknowns shown, never zero', 'Every rupee traceable'],
};

export const SOURCES: Array<{ label: string; icon: IconName }> = [
  { label: 'Shopify orders', icon: 'store' },
  { label: 'Marketplace reports', icon: 'bag' },
  { label: 'Meta / Google Ads', icon: 'megaphone' },
  { label: 'Courier & returns', icon: 'truck' },
  { label: 'Payment reports', icon: 'card' },
  { label: 'Your own CSV / JSON', icon: 'file' },
];

/** Three reasons, each tied to a screen that exists today. */
export const FEATURES: Array<{ tag: string; title: string; text: string; icon: IconName; href: string }> = [
  {
    tag: 'Ledger',
    title: 'See what every order kept',
    text: 'Refunds, recovery, shipping, fees and ads come off each order. Totals reconcile across channels and products, and a missing value stays unknown, never zero.',
    icon: 'receipt',
    href: demoPage('ledger?load=extended'),
  },
  {
    tag: 'Leaks & Pulse',
    title: 'Find where profit leaks',
    text: 'Losing orders grouped by cause, months compared, products to push or fix, and COD vs prepaid, with the top 3 actions ranked in rupees.',
    icon: 'search',
    href: demoPage('pulse?load=demo_12m'),
  },
  {
    tag: 'Decision',
    title: 'Act on one change',
    text: 'Test one lever, such as recovery or shipping, see the rupee effect, and save the decision with a 30-day test and a stop rule.',
    icon: 'sliders',
    href: demoPage('scenario?load=extended'),
  },
];

export const STEPS: Array<{ title: string; text: string; icon: IconName; href: string }> = [
  {
    title: 'Upload your exports',
    text: 'Drop up to 12 CSV or JSON files at once. Every row is checked, and orders already saved are skipped.',
    icon: 'upload',
    href: demoPage('import'),
  },
  {
    title: 'See contribution and leaks',
    text: 'Per-order contribution, the biggest rupee leaks, and your best and weakest months on one dashboard.',
    icon: 'bar-chart',
    href: demoPage('pulse?load=demo_12m'),
  },
  {
    title: 'Decide, then measure',
    text: 'Pick one fix, test it for 30 days with a stop rule, and keep the numbers it was based on.',
    icon: 'clipboard',
    href: demoPage('decision?load=extended'),
  },
];

export interface Plan {
  name: string;
  /** ₹ a month; 0 is the free plan. */
  monthly: number;
  orders: string;
  blurb: string;
  features: string[];
  cta: string;
  popular?: boolean;
}

export const ANNUAL_DISCOUNT = 0.2;

/** Every paid plan gets every feature; plans differ by order volume, and Scale adds API access. */
const EVERY_PLAN = ['Ledger, leak board and Pulse', 'Scenarios and decision record', 'Up to 12 files merged per upload', 'Saved data and CSV export'];

export const PLANS: Plan[] = [
  {
    name: 'Free',
    monthly: 0,
    orders: 'Up to 100 orders a month',
    blurb: 'See your own numbers. No card needed.',
    features: ['Ledger, leak board and Pulse', 'Saved data in one workspace', 'CSV and JSON upload'],
    cta: 'Start free',
  },
  {
    name: 'Starter',
    monthly: 999,
    orders: 'Up to 500 orders a month',
    blurb: 'For a brand finding its first leaks.',
    features: EVERY_PLAN,
    cta: 'Start 14-day trial',
  },
  {
    name: 'Growth',
    monthly: 2999,
    orders: 'Up to 3,000 orders a month',
    blurb: 'For a brand selling on several channels.',
    features: EVERY_PLAN,
    cta: 'Start 14-day trial',
    popular: true,
  },
  {
    name: 'Scale',
    monthly: 7999,
    orders: 'Up to 15,000 orders a month',
    blurb: 'For high-volume brands and their teams.',
    features: [...EVERY_PLAN, 'API access'],
    cta: 'Start 14-day trial',
  },
];

export const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Do I need to connect my store?',
    a: 'No. You start with the exports you already have, as CSV or JSON in our order template. Nothing is installed and nothing changes in your store. Live store connectors are a future direction, not something we offer today.',
  },
  {
    q: 'What files can I upload?',
    a: 'CSV or JSON with a downloadable template and aliases for common column names. Upload up to 12 files at once, for example one per month; they are merged, and orders already saved to your account are skipped.',
  },
  {
    q: 'Why “contribution” and not “profit”?',
    a: 'It measures what each order leaves after refunds, recovery, shipping, fees and ads. Rent, salaries and tax are not in an order file, so this is operational contribution, not statutory net profit.',
  },
  {
    q: 'Is my data safe?',
    a: 'When you sign in, your uploads and decisions are saved to your account and other accounts cannot read them. The demo uses sample data. You can export to CSV at any time.',
  },
  {
    q: 'What is free, and how does the trial work?',
    a: 'The Free plan covers up to 100 orders a month, with no card. Paid plans start with a 14-day trial on your own orders, with every feature, before you decide anything.',
  },
];
