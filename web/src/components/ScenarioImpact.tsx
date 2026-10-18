import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Candidate, ScenarioResponse } from '../api/types';
import { formatPct2, readMargins } from '../api/proof';
import { formatInr, formatSignedInr } from '../lib/format';
import { OVERRIDE_LABELS } from '../lib/labels';
import { Provenance } from './Provenance';

type Line = { key: 'net_sales_inr' | 'net_product_cost_inr' | 'shipping_inr' | 'payment_fee_inr' | 'return_cost_inr' | 'handling_inr' | 'ads_inr'; labelKey: string; label: string };

const LINES: Line[] = [
  { key: 'net_sales_inr', labelKey: 'ledger.netSales', label: 'Net sales' },
  { key: 'net_product_cost_inr', labelKey: 'scenario.rowNpc', label: 'Net product cost' },
  { key: 'shipping_inr', labelKey: 'ledger.shipping', label: 'Shipping' },
  { key: 'payment_fee_inr', labelKey: 'scenario.rowFee', label: 'Payment fee' },
  { key: 'return_cost_inr', labelKey: 'ledger.returnCost', label: 'Return cost' },
  { key: 'handling_inr', labelKey: 'ledger.handling', label: 'Handling' },
  { key: 'ads_inr', labelKey: 'ledger.ads', label: 'Ads' },
];

/**
 * Everything the scenario changed, from the one server calculation: the lines that moved, the three margins before and
 * after, and a check that the delta equals scenario minus baseline. Nothing here is computed on the screen except that
 * subtraction, which is shown so it can be seen to hold.
 */
export function ScenarioImpact({ s }: { s: ScenarioResponse }) {
  const { t } = useTranslation();
  const moved = LINES.filter((l) => (s.delta[l.key] ?? 0) !== 0);
  const b = s.baseline.contribution_inr;
  const a = s.scenario.contribution_inr;
  const m = s as unknown as { margins?: { baseline?: unknown; scenario?: unknown } };
  const mb = readMargins({ margins: m.margins?.baseline });
  const ms = readMargins({ margins: m.margins?.scenario });
  const what = OVERRIDE_LABELS[s.changed as keyof typeof OVERRIDE_LABELS] ?? s.changed;
  return (
    <section className="card impact-card" aria-labelledby="impact-title">
      <h2 id="impact-title" className="card-title">
        {t('impact.title', 'What this change moved')} <Provenance kind="assumed" />
      </h2>
      <p className="muted small">{t('impact.sub', 'You changed {{what}}. Everything below comes from the same calculation on your orders.', { what })}</p>
      {b !== null && a !== null ? (
        <p className="impact-sum num">
          {formatInr(a)} − {formatInr(b)} = <strong>{formatSignedInr(a - b)}</strong>
        </p>
      ) : null}
      {moved.length > 0 ? (
        <table className="table table-compact">
          <caption className="visually-hidden">{t('impact.caption', 'Lines that changed')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('scenario.line')}</th>
              <th scope="col" className="r">{t('scenario.observedBaseline', 'Observed baseline')}</th>
              <th scope="col" className="r">{t('scenario.assumedScenario', 'Assumed scenario')}</th>
              <th scope="col" className="r">{t('scenario.delta')}</th>
            </tr>
          </thead>
          <tbody>
            {moved.map((l) => (
              <tr key={l.key}>
                <th scope="row">{t(l.labelKey, l.label)}</th>
                <td className="r num">{s.baseline[l.key] === null ? '—' : formatInr(s.baseline[l.key] as number)}</td>
                <td className="r num">{s.scenario[l.key] === null ? '—' : formatInr(s.scenario[l.key] as number)}</td>
                <td className="r num">{formatSignedInr(s.delta[l.key] as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">{t('impact.none', 'No cost line moved; only the treatment of existing figures changed.')}</p>
      )}
      {mb && ms ? (
        <dl className="impact-margins">
          {(
            [
              ['cm1_pct', 'unit.cm1Short', 'Gross margin %'],
              ['cm2_pct', 'unit.cm2Short', 'CM2 %'],
              ['cm3_pct', 'unit.cm3Short', 'CM3 %'],
            ] as const
          ).map(([k, key, label]) => (
            <div key={k}>
              <dt>{t(key, label)}</dt>
              <dd className="num">
                {mb[k] === null ? '—' : formatPct2(mb[k] as number)} → <strong>{ms[k] === null ? '—' : formatPct2(ms[k] as number)}</strong>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {s.delta.unknown !== 0 || s.scenario.unknown > 0 ? (
        <p className="muted small">{t('impact.unknown', '{{n}} orders still have missing facts and are left out of these totals, never counted as zero.', { n: s.scenario.unknown })}</p>
      ) : null}
    </section>
  );
}

/** Why the recommended fix did or did not move, read from the two candidate lists (no rule is assumed). */
export function recommendationNote(t: TFunction, baseline: Candidate[], scenario: Candidate[], recKey: string): string | null {
  const was = baseline.find((c) => c.intervention === recKey);
  const now = scenario.find((c) => c.intervention === recKey);
  if (!was || !now) return null;
  if (was.delta_inr === now.delta_inr) {
    return t('impact.recSame', 'Its gain is unchanged ({{inr}}): this change does not touch what this fix works on.', { inr: formatSignedInr(now.delta_inr) });
  }
  return t('impact.recMoved', 'Its gain moved from {{was}} to {{now}} under this scenario.', { was: formatSignedInr(was.delta_inr), now: formatSignedInr(now.delta_inr) });
}
