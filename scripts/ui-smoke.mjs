// UI smoke (Blueprint §18.1): landing → load fixture → worked order → order drawer → toggle mode → scenario → save decision
// → checks panel → Pulse on the 12-month demo.
// Needs the web app running (npm run dev:web, or compose on :3000). Uses the installed Edge by default:
//   WEB_URL=http://localhost:5173 node scripts/ui-smoke.mjs        (BROWSER_CHANNEL=chrome|msedge, or "chromium" in CI)
import { chromium } from 'playwright-core';

const WEB = (process.env.WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const channel = process.env.BROWSER_CHANNEL ?? 'msedge';
const inr = (n) => new RegExp(`₹\\s?${n.replace(',', ',')}`);
const steps = [];
const errors = [];

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    steps.push(`PASS  ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    steps.push(`FAIL  ${name}: ${err.message.split('\n')[0]}`);
    throw err;
  }
}

const browser = await chromium.launch(channel === 'chromium' ? {} : { channel });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => m.type() === 'error' && !/422|Unprocessable/.test(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
page.setDefaultTimeout(10_000);

try {
  await step('Landing: tagline, and Try the demo opens the app', async () => {
    await page.goto(`${WEB}/`);
    await page.getByRole('heading', { name: /Know More\.\s*Earn Better\./i }).first().waitFor();
    await page.getByRole('link', { name: /Try the (live )?demo/i }).first().click();
    await page.waitForURL(/\/app\//);
  });

  await step('Import: load the sample orders and see the validation report', async () => {
    await page.goto(`${WEB}/app/#/import`);
    await page.getByRole('button', { name: /Load sample orders/i }).first().click();
    await page.getByText(/Validation report/i).first().waitFor();
    await page.getByRole('button', { name: /Continue to ledger/i }).first().click();
  });

  await step('Ledger: contribution ₹ 6,000 and reconciled', async () => {
    await page.getByText(inr('6,000')).first().waitFor();
    await page.getByText(/Reconciled/i).first().waitFor();
  });

  await step('Check 1: worked order drawer shows ₹ 230', async () => {
    await page.getByRole('button', { name: /Worked order/i }).first().click();
    await page.getByRole('dialog').getByText(inr('230')).first().waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  });

  await step('Order drawer: O05 shows −₹ 180', async () => {
    await page.getByRole('button', { name: 'Open the waterfall for O05' }).first().click();
    await page.getByRole('dialog').getByText(/−₹\s?180/).first().waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  });

  await step('Check 2: channel mode keeps the reconciliation green', async () => {
    await page.getByRole('radio', { name: /Channel spend/i }).first().click().catch(async () => {
      await page.getByRole('button', { name: /Channel spend/i }).first().click();
    });
    await page.waitForTimeout(500);
    await page.getByText(/Reconciled/i).first().waitFor();
    await page.getByText(inr('6,000')).first().waitFor();
  });

  await step('Check 3: recovery ₹ 200 changes the recommendation', async () => {
    await page.goto(`${WEB}/#/scenario?load=null_refund`);
    await page.getByText(/Change one assumption/i).first().waitFor();
    await page.getByRole('radio', { name: /Recovery per return/i }).first().check();
    const rupees = page.getByRole('textbox', { name: /recovered|per return|₹/i }).first();
    const field = (await rupees.count()) ? rupees : page.locator('input[inputmode="decimal"], input[type="number"]').first();
    await field.fill('200');
    await field.press('Enter');
    await page.getByRole('button', { name: /Run scenario/i }).first().click();
    const flip = page.locator(':is(p, div, span)', { hasText: /Before:\s*Charge return shipping\s*₹\s?150/ }).filter({ hasText: /Now:\s*Raise recovery via inspection\s*₹\s?480/ });
    await flip.first().waitFor();
  });

  await step('Decision: draft the 30-day test and save', async () => {
    await page.locator('a, button', { hasText: /Use this in a decision/i }).first().click();
    await page.getByRole('radio', { name: /Raise recovery via inspection/i }).first().check();
    await page.getByRole('button', { name: /Draft 30-day test/i }).first().click();
    await page.getByRole('textbox', { name: /Owner/i }).first().fill('UI smoke');
    await page.getByRole('button', { name: /Save decision/i }).first().click();
    await page.getByText(/Decision saved/i).first().waitFor();
  });

  await step('Public checks panel: 25 of 25 points, three PASS', async () => {
    await page.goto(`${WEB}/app/#/ledger?load=fixture&checks=1`);
    const panel = page.getByRole('dialog');
    await panel.getByText(/25 of 25 points/).first().waitFor();
    const passes = await panel.getByText(/^PASS$/).count();
    if (passes < 3) throw new Error(`expected 3 PASS pills, saw ${passes}`);
    await page.keyboard.press('Escape');
  });

  await step('Import: two monthly CSVs merge into one dataset; Pulse compares the months', async () => {
    const head = 'order_id,date,gross_inr,discount_inr,refund_inr,net_sales_inr,product_cost_inr,recovered_product_cost_inr,shipping_inr,payment_fee_inr,return_cost_inr,returned\n';
    const aug = head + 'M1,2026-08-04,1200,100,0,1100,500,0,60,22,0,false\nM2,2026-08-19,900,0,0,900,400,0,60,18,0,false\n';
    const sep = head + 'M3,2026-09-03,2000,200,0,1800,700,0,70,36,0,false\nM4,2026-09-21,800,0,800,0,350,300,60,16,50,true\n';
    await page.goto(`${WEB}/app/#/import`);
    await page.locator('input[type="file"]').setInputFiles([
      { name: 'aug.csv', mimeType: 'text/csv', buffer: Buffer.from(aug) },
      { name: 'sep.csv', mimeType: 'text/csv', buffer: Buffer.from(sep) },
    ]);
    await page.getByText(/2 files merged/i).first().waitFor();
    await page.getByRole('button', { name: /Continue to ledger/i }).first().click();
    await page.getByText(/Reconciled/i).first().waitFor();
    await page.getByRole('link', { name: /Pulse/i }).first().click();
    await page.getByText(/Best months/i).first().waitFor();
    await page.getByText(/Aug 2026 sold the most/i).first().waitFor();
    await page.getByText(/Sep 2026 sold the least/i).first().waitFor();
  });

  await step('Pulse: a one-month file names no best or weakest month', async () => {
    await page.goto(`${WEB}/app/#/import`);
    await page.getByRole('button', { name: /Load sample orders/i }).first().click();
    await page.getByRole('button', { name: /Continue to ledger/i }).first().click();
    await page.getByText(/Reconciled/i).first().waitFor();
    await page.getByRole('link', { name: /Pulse/i }).first().click();
    await page.getByText(/need at least two months/i).first().waitFor();
    if (await page.getByRole('heading', { name: 'Weakest months', exact: true }).count()) throw new Error('weakest months shown for a one-month file');
  });

  await step('Pulse: 12-month demo shows best months and three ranked actions', async () => {
    await page.goto(`${WEB}/app/#/import`);
    await page.getByRole('button', { name: /Load 12-month demo/i }).first().click();
    await page.getByText(/Best months/i).first().waitFor({ timeout: 20_000 });
    await page.getByText(/Synthetic demo data/i).first().waitFor();
    await page.getByText(/Top 3 actions/i).first().waitFor();
  });

  if (errors.length) throw new Error(`console errors: ${errors.join(' | ')}`);
} catch (err) {
  await page.screenshot({ path: 'ui-smoke-failure.png', fullPage: true }).catch(() => undefined);
  console.log(steps.join('\n'));
  console.error(`UI smoke failed: ${err.message.split('\n')[0]} (screenshot: ui-smoke-failure.png)`);
  await browser.close();
  process.exit(1);
}

console.log(steps.join('\n'));
console.log(`UI smoke: ${steps.length}/${steps.length} steps passed · ${WEB}`);
await browser.close();
