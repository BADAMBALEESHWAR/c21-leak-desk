// UI smoke (Blueprint §18.1): load fixture → worked order → order drawer → toggle mode → scenario → save decision.
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
  await step('Import: load the C21 fixture and see the validation report', async () => {
    await page.goto(`${WEB}/#/import`);
    await page.getByRole('button', { name: /Load C21 fixture/i }).first().click();
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
    await page.getByLabel(/Owner/i).first().fill('UI smoke');
    await page.getByRole('button', { name: /Save decision/i }).first().click();
    await page.getByText(/Decision saved/i).first().waitFor();
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
