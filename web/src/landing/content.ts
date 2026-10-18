// Landing copy. Every claim here maps to something the product does today; anything not built is labelled.
// Each text carries its translation key next to the English default; the components render t(key, text), so the
// language can change at runtime (nothing is translated at import time).
import { APP_PATH } from '../brand';
import type { IconName } from './icons';

/** A translated text: its key in web/src/i18n/*.json and the English default. */
export interface Copy {
  key: string;
  text: string;
}

/** Deep links into the app open in demo mode on the sample data, so nothing is tied to an account. */
const demoPage = (route: string) => `${APP_PATH}?mode=demo#/${route}`;

/** The body takes {{brand}}; the language list under the ticks is built from the switcher's own names. */
export const HERO: { eyebrow: Copy; lead: Copy; body: Copy; ticks: Copy[] } = {
  eyebrow: { key: 'landing.heroEyebrow', text: 'AI profit analyst for D2C brands' },
  lead: { key: 'landing.heroLead', text: 'Know where your money goes. Know what to do next.' },
  body: {
    key: 'landing.heroBody',
    text: "Upload your order exports. {{brand}}'s AI works through every order — refunds, returns, shipping, fees and ads — finds where profit leaks, ranks the three fixes worth the most, and saves your decision in one click. Every rupee comes from a tested engine, never guessed.",
  },
  ticks: [
    { key: 'landing.tickAutopilot', text: 'AI Autopilot: upload, then accept' },
    { key: 'landing.tickEngine', text: 'Every rupee from a tested engine' },
  ],
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

export const SOURCES: Array<{ key: string; label: string; icon: IconName }> = [
  { key: 'landing.srcShopify', label: 'Shopify orders', icon: 'store' },
  { key: 'landing.srcMarketplace', label: 'Marketplace reports', icon: 'bag' },
  { key: 'landing.srcAds', label: 'Meta / Google Ads', icon: 'megaphone' },
  { key: 'landing.srcCourier', label: 'Courier & returns', icon: 'truck' },
  { key: 'landing.srcPayments', label: 'Payment reports', icon: 'card' },
  { key: 'landing.srcOwn', label: 'Your own CSV / JSON', icon: 'file' },
];

/** Three reasons, each tied to a screen that exists today. */
export const FEATURES: Array<{ tagKey: string; tag: string; titleKey: string; title: string; textKey: string; text: string; icon: IconName; href: string }> = [
  {
    tagKey: 'landing.featAutopilotTag',
    tag: 'AI Autopilot',
    titleKey: 'landing.featAutopilotTitle',
    title: 'Upload. Profyn does the rest.',
    textKey: 'landing.featAutopilotText',
    text: 'Contribution per order, leaks by cause, and the top 3 fixes ranked in rupees, each explained in plain words and saved as a decision in one click.',
    icon: 'sliders',
    href: demoPage('overview?load=demo_12m'),
  },
  {
    tagKey: 'landing.featAskTag',
    tag: 'Ask Profyn',
    titleKey: 'landing.featAskTitle',
    title: 'Ask your numbers anything',
    textKey: 'landing.featAskText',
    text: 'Type or speak in English, Hindi or Telugu: "Which product lost most in September?" The answer comes from your own orders, with a link to the orders behind it.',
    icon: 'search',
    href: demoPage('ai'),
  },
  {
    tagKey: 'landing.featLedgerTag',
    tag: 'Ledger',
    titleKey: 'landing.featLedgerTitle',
    title: 'Click a leak, see the orders',
    textKey: 'landing.featLedgerText',
    text: 'Every cause and chart opens the exact orders behind it. Totals reconcile across channels and products, and a missing value stays unknown, never zero.',
    icon: 'receipt',
    href: demoPage('ledger?load=demo_12m'),
  },
];

/** Why Profyn and not a chat model, and the data promise: shown on the landing page (moved out of the app sidebar). */
export const TRUST: { why: Copy[]; promise: Copy[] } = {
  why: [
    { key: 'landing.trustWhy1', text: 'Every rupee comes from a tested engine with 360+ automated tests; the AI only explains the numbers.' },
    { key: 'landing.trustWhy2', text: 'Any AI sentence with a figure the engine did not produce is rejected before you see it.' },
    { key: 'landing.trustWhy3', text: 'Thousands of orders reconcile to channel and product totals, the same way every month.' },
    { key: 'landing.trustWhy4', text: 'Each decision is saved with the numbers it was based on and a 30-day check.' },
  ],
  promise: [
    { key: 'landing.trustPromise1', text: 'Stored in India on AWS Mumbai; uploaded files are encrypted at rest and every connection uses HTTPS.' },
    { key: 'landing.trustPromise2', text: 'Your account only: other accounts cannot read your data, and we never sell it.' },
    { key: 'landing.trustPromise3', text: 'The AI sees totals by cause, never your order rows, and it is off for your uploads unless you switch it on.' },
    { key: 'landing.trustPromise4', text: 'Export or delete everything at any time.' },
  ],
};

export const STEPS: Array<{ titleKey: string; title: string; textKey: string; text: string; icon: IconName; href: string }> = [
  {
    titleKey: 'landing.step1Title',
    title: 'Upload your exports',
    textKey: 'landing.step1Text',
    text: 'Drop up to 12 CSV or JSON files at once. Every row is checked, and orders already saved are skipped.',
    icon: 'upload',
    href: demoPage('import'),
  },
  {
    titleKey: 'landing.step2Title',
    title: 'AI finds the leaks and the fixes',
    textKey: 'landing.step2Text',
    text: 'Autopilot computes every order, groups the losses by cause and ranks the three fixes worth the most, explained in your language.',
    icon: 'bar-chart',
    href: demoPage('overview?load=demo_12m'),
  },
  {
    titleKey: 'landing.step3Title',
    title: 'Accept, then measure',
    textKey: 'landing.step3Text',
    text: 'Accept a fix in one click: it is saved with a 30-day test, a stop rule and the numbers it was based on.',
    icon: 'clipboard',
    href: demoPage('decision?load=extended'),
  },
];

export interface Plan {
  /** English plan name; also the anchor id (plan-Free). */
  name: string;
  nameKey: string;
  /** ₹ a month; 0 is the free plan. */
  monthly: number;
  orders: string;
  ordersKey: string;
  blurb: string;
  blurbKey: string;
  features: Copy[];
  cta: string;
  ctaKey: string;
  popular?: boolean;
}

export const ANNUAL_DISCOUNT = 0.2;

/** Every paid plan gets every feature; plans differ by order volume, and Scale adds API access. */
const EVERY_PLAN: Copy[] = [
  { key: 'pricing.featLedger', text: 'Ledger, leak board and Pulse' },
  { key: 'pricing.featScenarios', text: 'Scenarios and decision record' },
  { key: 'pricing.featFiles', text: 'Up to 12 files merged per upload' },
  { key: 'pricing.featExport', text: 'Saved data and CSV export' },
];

export const PLANS: Plan[] = [
  {
    name: 'Free',
    nameKey: 'pricing.planFree',
    monthly: 0,
    orders: 'Up to 100 orders a month',
    ordersKey: 'pricing.ordersFree',
    blurb: 'See your own numbers. No card needed.',
    blurbKey: 'pricing.blurbFree',
    features: [
      { key: 'pricing.featLedger', text: 'Ledger, leak board and Pulse' },
      { key: 'pricing.featWorkspace', text: 'Saved data in one workspace' },
      { key: 'pricing.featUpload', text: 'CSV and JSON upload' },
    ],
    cta: 'Start free',
    ctaKey: 'pricing.ctaFree',
  },
  {
    name: 'Starter',
    nameKey: 'pricing.planStarter',
    monthly: 999,
    orders: 'Up to 500 orders a month',
    ordersKey: 'pricing.ordersStarter',
    blurb: 'For a brand finding its first leaks.',
    blurbKey: 'pricing.blurbStarter',
    features: EVERY_PLAN,
    cta: 'Start 14-day trial',
    ctaKey: 'pricing.ctaTrial',
  },
  {
    name: 'Growth',
    nameKey: 'pricing.planGrowth',
    monthly: 2999,
    orders: 'Up to 3,000 orders a month',
    ordersKey: 'pricing.ordersGrowth',
    blurb: 'For a brand selling on several channels.',
    blurbKey: 'pricing.blurbGrowth',
    features: EVERY_PLAN,
    cta: 'Start 14-day trial',
    ctaKey: 'pricing.ctaTrial',
    popular: true,
  },
  {
    name: 'Scale',
    nameKey: 'pricing.planScale',
    monthly: 7999,
    orders: 'Up to 15,000 orders a month',
    ordersKey: 'pricing.ordersScale',
    blurb: 'For high-volume brands and their teams.',
    blurbKey: 'pricing.blurbScale',
    features: [...EVERY_PLAN, { key: 'pricing.featApi', text: 'API access' }],
    cta: 'Start 14-day trial',
    ctaKey: 'pricing.ctaTrial',
  },
];

export const FAQ: Array<{ qKey: string; q: string; aKey: string; a: string }> = [
  {
    qKey: 'landing.trustWhyTitle',
    q: 'Why not just ask ChatGPT?',
    aKey: 'landing.faqChatgptA',
    a: 'ChatGPT gives you a story once; Profyn gives you a ledger every month. A chat model guesses figures and cannot reconcile thousands of orders to channel and product totals. In Profyn a tested engine computes every rupee, the AI only explains them, and any AI sentence with a figure the engine did not produce is rejected.',
  },
  {
    qKey: 'landing.faqConnectQ',
    q: 'Do I need to connect my store?',
    aKey: 'landing.faqConnectA',
    a: 'No. Upload the reports you already have: Shopify, Amazon, Flipkart, Myntra, Razorpay or Shiprocket exports are mapped automatically, and any other CSV is mapped once with AI help. Shopify stores can also connect directly with a read-only access token; Amazon, Flipkart and Myntra connectors are on the roadmap.',
  },
  {
    qKey: 'landing.faqFilesQ',
    q: 'What files can I upload?',
    aKey: 'landing.faqFilesA',
    a: 'CSV or JSON with a downloadable template and aliases for common column names. Upload up to 12 files at once, for example one per month; they are merged, and orders already saved to your account are skipped.',
  },
  {
    qKey: 'landing.faqContributionQ',
    q: 'Why “contribution” and not “profit”?',
    aKey: 'landing.faqContributionA',
    a: 'It measures what each order leaves after refunds, recovery, shipping, fees and ads. Rent, salaries and tax are not in an order file, so this is operational contribution, not statutory net profit.',
  },
  {
    qKey: 'landing.faqSafeQ',
    q: 'Is my data safe?',
    aKey: 'landing.faqSafeA',
    a: 'Your data is stored in India (AWS Mumbai), and other accounts cannot read it. The AI sees only totals by cause, never your order rows, and it is off for your uploads unless you switch it on. You can export or delete everything at any time.',
  },
  {
    qKey: 'landing.faqTrialQ',
    q: 'What is free, and how does the trial work?',
    aKey: 'landing.faqTrialA',
    a: 'The Free plan covers up to 100 orders a month, with no card. Paid plans start with a 14-day trial on your own orders, with every feature, before you decide anything.',
  },
];
