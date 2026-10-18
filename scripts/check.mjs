// make check / npm run check: the three public checks and the margin check against a running API (Blueprint §18.3).
// BASE_URL defaults to the local stack; point it at the CloudFront URL to check the AWS deploy.
const base = (process.env.BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const started = Date.now();

function row(name, text, detail, pass) {
  console.log(`${name.padEnd(8)}${text.padEnd(44)}${detail.padEnd(58)}${pass ? 'PASS' : 'FAIL'}`);
}

async function main() {
  let res;
  try {
    res = await fetch(`${base}/api/v1/checks`);
  } catch (err) {
    console.error(`FAIL  cannot reach ${base}/api/v1/checks (${err.cause?.code ?? err.message}). Start the API first: make up (or npm run dev:api).`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`FAIL  /checks returned HTTP ${res.status}`);
    process.exit(1);
  }
  const c = await res.json();
  row('check1', 'worked order contribution', `expected ${c.check1.expected}   actual ${c.check1.actual}`, c.check1.pass);
  row('check2', 'Σorders=Σchannels=Σproducts (both modes)', `${c.check2.allocate_total} = ${c.check2.channel_total} (never both: ${c.check2.never_both})`, c.check2.pass);
  row('check3', 'unknown labelled; recommendation changes', `${c.check3.before.intervention} → ${c.check3.after_recovery_50.intervention}`, c.check3.pass);
  const c4 = c.check4;
  row('check4', 'margins on the worked order', c4 ? `net revenue ${c4.net_revenue_inr}  CM1 ${c4.cm1_pct}%  CM2 ${c4.cm2_pct}%  CM3 ${c4.cm3_pct}%` : 'not returned by this API (older build)', c4?.pass === true);
  const checks = [c.check1.pass, c.check2.pass, c.check3.pass, c4?.pass === true];
  const passed = checks.filter(Boolean).length;
  console.log(`engine ${c.engine_version} · ${passed}/${checks.length} passed in ${((Date.now() - started) / 1000).toFixed(1)} s · ${base}`);
  process.exit(passed === checks.length ? 0 : 1);
}

main();
