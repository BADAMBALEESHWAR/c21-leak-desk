// Landing copy. Every claim here maps to something the product does today; anything not built is labelled.
import { APP_PATH, BRAND } from '../brand';
import type { IconName } from './icons';

/** Deep links into the app open in demo mode on the sample data, so nothing is tied to an account. */
const demoPage = (route: string) => `${APP_PATH}?mode=demo#/${route}`;

export const HERO = {
  eyebrow: 'AI profit analyst for D2C brands',
  lead: 'Know where your money goes. Know what to do next.',
  body: `Upload your order exports. ${BRAND.name}'s AI works through every order — refunds, returns, shipping, fees and ads — finds where profit leaks, ranks the three fixes worth the most, and saves your decision in one click. Every rupee comes from a tested engine, never guessed.`,
  ticks: ['AI Autopilot: upload, then accept', 'Every rupee from a tested engine', 'English · हिन्दी · తెలుగు'],
};

/**
 * The demo recording, served from web/public/media/. The player falls back on its own while the files are missing.
 * Set hasCaptions once profyn-demo.en.vtt is added, and youtubeUrl to an unlisted link to show "Prefer YouTube?" in the FAQ.
 */
export const DEMO_MEDIA = {
  video: '/media/profyn-demo.mp4',
  poster: '/media/profyn-demo-poster.jpg',
  captions: '/media/profyn-demo.en.vtt',
  hasCaptions: false as boolean,
  youtubeUrl: '' as string,
};

/** The change log in the app: refund and recovery semantics, before and after. */
export const CHANGELOG_URL = `${APP_PATH}#/changelog`;

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
    tag: 'AI Autopilot',
    title: 'Upload. Profyn does the rest.',
    text: 'Contribution per order, leaks by cause, and the top 3 fixes ranked in rupees, each explained in plain words and saved as a decision in one click.',
    icon: 'sliders',
    href: demoPage('overview?load=demo_12m'),
  },
  {
    tag: 'Ask Profyn',
    title: 'Ask your numbers anything',
    text: 'Type or speak in English, Hindi or Telugu: "Which product lost most in September?" The answer comes from your own orders, with a link to the orders behind it.',
    icon: 'search',
    href: demoPage('ai'),
  },
  {
    tag: 'Ledger',
    title: 'Click a leak, see the orders',
    text: 'Every cause and chart opens the exact orders behind it. Totals reconcile across channels and products, and a missing value stays unknown, never zero.',
    icon: 'receipt',
    href: demoPage('ledger?load=demo_12m'),
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
    title: 'AI finds the leaks and the fixes',
    text: 'Autopilot computes every order, groups the losses by cause and ranks the three fixes worth the most, explained in your language.',
    icon: 'bar-chart',
    href: demoPage('overview?load=demo_12m'),
  },
  {
    title: 'Accept, then measure',
    text: 'Accept a fix in one click: it is saved with a 30-day test, a stop rule and the numbers it was based on.',
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
    q: 'Why not just ask ChatGPT?',
    a: 'ChatGPT gives you a story once; Profyn gives you a ledger every month. A chat model guesses figures and cannot reconcile thousands of orders to channel and product totals. In Profyn a tested engine computes every rupee, the AI only explains them, and any AI sentence with a figure the engine did not produce is rejected.',
  },
  {
    q: 'Do I need to connect my store?',
    a: 'No. Upload the reports you already have: Shopify, Amazon, Flipkart, Myntra, Razorpay or Shiprocket exports are mapped automatically, and any other CSV is mapped once with AI help. Live store connectors are on the roadmap, not something we offer today.',
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
    a: 'Your data is stored in India (AWS Mumbai), and other accounts cannot read it. The AI sees only totals by cause, never your order rows, and it is off for your uploads unless you switch it on. You can export or delete everything at any time.',
  },
  {
    q: 'What is free, and how does the trial work?',
    a: 'The Free plan covers up to 100 orders a month, with no card. Paid plans start with a 14-day trial on your own orders, with every feature, before you decide anything.',
  },
];
