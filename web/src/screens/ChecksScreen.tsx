import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  check1Lines,
  check2Rows,
  checkResults,
  fetchChecks,
  fetchMissingRefund,
  fetchWorkedOrder,
  formatPct2,
  ProofError,
  readAssumptionControl,
  readFormula,
  type CheckOutcome,
  type MissingRefund,
  type ProofChecks,
  type SumKey,
  type WorkedOrder,
} from '../api/proof';
import type { AttributionMode } from '../api/types';
import { Pill } from '../components/Badge';
import { Button, ButtonLink } from '../components/Button';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/Page';
import { Callout, Skeleton } from '../components/ui';
import { localeFor } from '../i18n';
import { formatInr } from '../lib/format';
import { INTERVENTION_LABELS } from '../lib/labels';
import { hrefFor } from '../lib/router';
import { useStore } from '../state/store';
import '../styles/proof.css';

const CHECK_IDS = ['check1', 'check2', 'check3', 'check4'] as const;
type CheckId = (typeof CHECK_IDS)[number];

/** Return rates offered when the API does not list its own. */
const FALLBACK_RATES = [0, 10, 20, 30, 50];

const interventionName = (o: CheckOutcome | undefined) =>
  o ? o.label ?? INTERVENTION_LABELS[o.intervention] ?? String(o.intervention).replace(/_/g, ' ') : null;

function Status({ pass }: { pass: boolean | null }) {
  const { t } = useTranslation();
  if (pass === null) {
    return (
      <Pill tone="neutral" className="proof-status">
        {t('checks.notAvailable', 'Not available yet')}
      </Pill>
    );
  }
  return pass ? (
    <Pill tone="success" icon="check" className="proof-status">
      {t('checks.pass', 'PASS')}
    </Pill>
  ) : (
    <Pill tone="danger" icon="x" className="proof-status">
      {t('checks.fail', 'FAIL')}
    </Pill>
  );
}

function NotYet({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return <p className="proof-notyet">{children ?? t('checks.notAvailableLong', 'Not available yet: this API does not send this part of the check.')}</p>;
}

interface CardProps {
  id: CheckId;
  n: number;
  kicker: string;
  title: string;
  pass: boolean | null;
  aside: ReactNode;
  children: ReactNode;
}

function CheckCard({ id, n, kicker, title, pass, aside, children }: CardProps) {
  const { t } = useTranslation();
  const tone = pass === null ? 'is-na' : pass ? 'is-pass' : 'is-fail';
  return (
    <section id={`proof-${id}`} className={`card proof-check ${tone}`} aria-labelledby={`proof-${id}-title`} tabIndex={-1}>
      <header className="proof-check-head">
        <span className="proof-check-n" aria-hidden="true">
          {n}
        </span>
        <div className="proof-check-titles">
          <span className="proof-kicker">
            {t('checks.checkN', 'Check {{n}}', { n })} · {kicker}
          </span>
          <h2 id={`proof-${id}-title`} className="proof-check-title">
            {title}
          </h2>
        </div>
        <Status pass={pass} />
      </header>
      {pass === null ? (
        <div className="proof-working">{children}</div>
      ) : (
        <div className="proof-check-body">
          <div className="proof-aside">{aside}</div>
          <div className="proof-working">{children}</div>
        </div>
      )}
    </section>
  );
}

function BigValue({ value, sub, tone }: { value: ReactNode; sub?: ReactNode; tone?: 'gain' | 'warning' | 'default' }) {
  return (
    <div className={`proof-big${tone ? ` is-${tone}` : ''}`}>
      <span className="proof-big-value">{value}</span>
      {sub ? <span className="proof-big-sub">{sub}</span> : null}
    </div>
  );
}

// ---- Check 1 ----------------------------------------------------------------------------

function Check1({ data, worked }: { data: ProofChecks; worked: WorkedOrder | null }) {
  const { t } = useTranslation();
  const c1 = data.check1;
  const read = check1Lines(data, worked);
  const start = read?.lines[0]?.running_total_inr ?? 0;
  return (
    <CheckCard
      id="check1"
      n={1}
      kicker={t('checks.c1.kicker', 'Worked order')}
      title={t('checks.c1.title', 'Six lines, one running total, ₹230 at the end')}
      pass={c1 ? c1.pass : null}
      aside={
        c1 ? (
          <>
            <BigValue
              value={formatInr(c1.actual)}
              sub={t('checks.c1.expected', 'Contribution · expected {{value}}', { value: formatInr(c1.expected) })}
              tone={c1.actual === c1.expected ? 'gain' : 'default'}
            />
            <p className="proof-text">
              {t('checks.c1.text', 'Revenue less the refund, net product cost, shipping, ads and handling, one line at a time. Net product cost is already after recovery, so recovery is not subtracted twice.')}
            </p>
            <ul className="proof-facts">
              <li>
                <Icon name={c1.six_lines ? 'check' : 'x'} size={14} strokeWidth={2.5} />
                {t('checks.c1.sixLines', 'Exactly six waterfall lines')}
              </li>
              <li>
                <Icon name={c1.actual === c1.expected ? 'check' : 'x'} size={14} strokeWidth={2.5} />
                {t('checks.c1.matches', 'Matches data/expected.json')}
              </li>
            </ul>
          </>
        ) : (
          <NotYet />
        )
      }
    >
      {read ? (
        <div className="table-scroll">
          <table className="table table-compact proof-table">
            <caption className="visually-hidden">{t('checks.c1.caption', 'Worked order, line by line, with the running total')}</caption>
            <thead>
              <tr>
                <th scope="col" className="proof-col-n">
                  #
                </th>
                <th scope="col">{t('checks.col.line', 'Line')}</th>
                <th scope="col" className="r">
                  {t('checks.col.amount', 'Amount')}
                </th>
                <th scope="col" className="r">
                  {t('checks.col.running', 'Running total')}
                </th>
                <th scope="col" className="proof-col-bar">
                  <span className="visually-hidden">{t('checks.col.bar', 'Share of revenue left')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {read.lines.map((l, i) => {
                const prev = i === 0 ? l.running_total_inr : read.lines[i - 1].running_total_inr;
                const pct = start > 0 ? Math.max(0, Math.min(100, (l.running_total_inr / start) * 100)) : 0;
                const cut = start > 0 && i > 0 ? Math.max(0, Math.min(100 - pct, ((prev - l.running_total_inr) / start) * 100)) : 0;
                return (
                  <tr key={`${l.key}-${i}`}>
                    <td className="muted proof-col-n">{i + 1}</td>
                    <th scope="row">{l.label}</th>
                    <td className={`r num${l.amount_inr < 0 ? ' t-loss' : ''}`}>{formatInr(l.amount_inr)}</td>
                    <td className="r num proof-strong">{formatInr(l.running_total_inr)}</td>
                    <td className="proof-col-bar" aria-hidden="true">
                      <span className="proof-run">
                        <span className="proof-run-fill" style={{ width: `${pct}%` }} />
                        {cut > 0 ? <span className="proof-run-cut" style={{ left: `${pct}%`, width: `${cut}%` }} /> : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {c1 ? (
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3}>
                    {t('checks.c1.result', 'Contribution')}
                  </th>
                  <td className="r num">{formatInr(c1.actual)}</td>
                  <td>
                    <Status pass={c1.pass} />
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
          {read.source === 'worked-order' ? (
            <p className="proof-source">{t('checks.c1.fromWorked', 'Lines from GET /api/v1/worked-order; this API does not send check1.lines yet.')}</p>
          ) : null}
        </div>
      ) : (
        <NotYet />
      )}
    </CheckCard>
  );
}

// ---- Check 2 ----------------------------------------------------------------------------

function DiffCell({ diff }: { diff: number | null }) {
  const { t } = useTranslation();
  if (diff === null) return <span className="muted">{t('checks.notAvailable', 'Not available yet')}</span>;
  const ok = Math.round(Math.abs(diff) * 100) === 0;
  return (
    <span className={`proof-diff ${ok ? 'is-ok' : 'is-bad'}`}>
      <Icon name={ok ? 'check' : 'x'} size={14} strokeWidth={2.5} />
      {t('checks.c2.difference', 'Difference = {{value}}', { value: formatInr(ok ? 0 : diff) })}
    </span>
  );
}

function Check2({ data, currentMode }: { data: ProofChecks; currentMode: AttributionMode }) {
  const { t } = useTranslation();
  const c2 = data.check2;
  const [mode, setMode] = useState<AttributionMode>(currentMode);
  useEffect(() => setMode(currentMode), [currentMode]);
  const rows = check2Rows(c2, mode);
  const sumLabel: Record<SumKey, string> = {
    orders: t('checks.c2.sumOrders', 'Σ orders'),
    channels: t('checks.c2.sumChannels', 'Σ channels'),
    products: t('checks.c2.sumProducts', 'Σ products'),
  };
  const modes: Array<{ value: AttributionMode; label: string }> = [
    { value: 'allocate', label: t('checks.mode.allocate', 'Ads allocated per order') },
    { value: 'channel', label: t('checks.mode.channel', 'Channel spend') },
  ];
  const conflict = c2?.conflict;
  const conflictPass = conflict ? conflict.pass : c2 ? c2.never_both : null;
  const total = mode === 'channel' ? c2?.channel_total : c2?.allocate_total;

  return (
    <CheckCard
      id="check2"
      n={2}
      kicker={t('checks.c2.kicker', 'Reconciliation')}
      title={t('checks.c2.title', 'Orders, channels and products add up; ads are never deducted twice')}
      pass={c2 ? c2.pass : null}
      aside={
        c2 ? (
          <>
            <BigValue
              value={typeof total === 'number' ? formatInr(total) : '—'}
              sub={t('checks.c2.both', 'Extended sample · {{allocate}} allocated = {{channel}} channel spend', {
                allocate: formatInr(c2.allocate_total),
                channel: formatInr(c2.channel_total),
              })}
              tone="gain"
            />
            <fieldset className="proof-toggle">
              <legend className="proof-toggle-legend">{t('checks.c2.showMode', 'Attribution mode')}</legend>
              <div className="segmented">
                {modes.map((m) => (
                  <label key={m.value} className="segmented-item">
                    <input type="radio" name="proof-mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} />
                    <span>{m.label}</span>
                  </label>
                ))}
              </div>
              <span className="proof-toggle-note">
                {mode === currentMode
                  ? t('checks.c2.currentMode', 'This is the mode of your current analysis.')
                  : t('checks.c2.otherMode', 'The other mode: the totals do not move.')}
              </span>
            </fieldset>
          </>
        ) : (
          <NotYet />
        )
      }
    >
      {c2 ? (
        <div className="table-scroll">
          <table className="table table-compact proof-table">
            <caption className="visually-hidden">{t('checks.c2.caption', 'Sums by level for the sample and extended files')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('checks.col.sum', 'Sum')}</th>
                <th scope="col" className="r">
                  {t('checks.col.fixture', 'Sample orders')}
                </th>
                <th scope="col" className="r">
                  {t('checks.col.extended', 'Extended sample')}
                </th>
                <th scope="col">{t('checks.col.difference', 'Difference')}</th>
              </tr>
            </thead>
            <tbody>
              {rows ? (
                rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row">{sumLabel[r.key]}</th>
                    <td className="r num">{r.fixture === null ? '—' : formatInr(r.fixture)}</td>
                    <td className="r num">{r.extended === null ? '—' : formatInr(r.extended)}</td>
                    <td>
                      <DiffCell diff={r.difference} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>
                    <NotYet />
                  </td>
                </tr>
              )}
              <tr className={`proof-conflict${conflictPass ? ' is-ok' : ''}`}>
                <th scope="row" colSpan={3} className="cell-wrap">
                  <span className="proof-conflict-text">
                    {t('checks.c2.conflict', 'Ads deducted in both modes')} <Icon name="arrow-right" size={14} /> <code>AttributionConflict</code>{' '}
                    <span className="muted">{t('checks.c2.expectedFailure', '(expected failure)')}</span>
                  </span>
                </th>
                <td>
                  <span className="proof-conflict-result">
                    <Status pass={conflictPass} />
                    <span className="proof-conflict-status">
                      {conflict
                        ? t('checks.c2.status', 'expected {{expected}} · got {{actual}}', {
                            expected: conflict.expected_status,
                            actual: conflict.actual_status ?? '—',
                          })
                        : t('checks.c2.refused', 'refused by the engine')}
                    </span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="proof-source">
            {t('checks.c2.note', 'The last row is green only because the API refused the request: deducting ads per order and as channel spend at the same time must fail.')}
          </p>
        </div>
      ) : (
        <NotYet />
      )}
    </CheckCard>
  );
}

// ---- Check 3 ----------------------------------------------------------------------------

function Outcome({ heading, o, tone }: { heading: ReactNode; o: CheckOutcome | undefined; tone: 'before' | 'after' }) {
  const { t } = useTranslation();
  const name = interventionName(o);
  return (
    <div className={`proof-outcome is-${tone}`}>
      <span className="proof-outcome-head">{heading}</span>
      <strong className="proof-outcome-name">{name ?? t('checks.notAvailable', 'Not available yet')}</strong>
      {o && typeof o.expected_delta_inr === 'number' ? (
        <span className="proof-outcome-delta num">{t('checks.c3.delta', '{{value}} a month expected', { value: formatInr(o.expected_delta_inr) })}</span>
      ) : null}
    </div>
  );
}

function Check3({ data, runId }: { data: ProofChecks; runId: number }) {
  const { t } = useTranslation();
  const c3 = data.check3;
  const control = readAssumptionControl(c3?.assumption_control);
  const values = control?.values ?? FALLBACK_RATES;
  const [rate, setRate] = useState<number>(control?.initial ?? values[Math.min(2, values.length - 1)]);
  const [result, setResult] = useState<MissingRefund | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'missing' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    setState('loading');
    setError(null);
    fetchMissingRefund(rate)
      .then((r) => {
        if (id !== seq.current) return;
        setResult(r);
        setState('idle');
      })
      .catch((err: unknown) => {
        if (id !== seq.current) return;
        setResult(null);
        if (err instanceof ProofError && err.status === 404) {
          setState('missing');
        } else {
          setState('error');
          setError(err instanceof Error ? err.message : String(err));
        }
      });
  }, [rate, runId]);

  const unknownOrder = result?.unknown_order ?? 'O05';
  const totalLabel = result?.total_label ?? (c3?.unknown_labelled ? 'partial (1 unknown)' : null);
  const label = result?.label ?? null;
  const before = result?.before ?? c3?.before;
  const after = result ? result.after : c3?.after_recovery_50;
  const changed = result ? result.changed : c3?.recommendation_changed ?? null;
  const live = result !== null;

  return (
    <CheckCard
      id="check3"
      n={3}
      kicker={t('checks.c3.kicker', 'Missing refund')}
      title={t('checks.c3.title', 'Unknown stays unknown; a stated assumption moves the recommendation')}
      pass={c3 ? c3.pass : null}
      aside={
        c3 ? (
          <>
            <BigValue
              value={t('checks.c3.unknown', 'Unknown')}
              sub={t('checks.c3.sub', '{{order}} has no refund in the file, so it is never counted as ₹0', { order: unknownOrder })}
              tone="warning"
            />
            <ul className="proof-facts">
              <li>
                <Icon name={c3.unknown_labelled ? 'check' : 'x'} size={14} strokeWidth={2.5} />
                {t('checks.c3.labelled', 'Labelled unknown, total marked partial')}
              </li>
              <li>
                <Icon name={c3.confidence === 'unknown' ? 'check' : 'x'} size={14} strokeWidth={2.5} />
                {t('checks.c3.confidence', 'Recommendation confidence: {{value}}', { value: c3.confidence })}
              </li>
              <li>
                <Icon name={c3.recommendation_changed ? 'check' : 'x'} size={14} strokeWidth={2.5} />
                {t('checks.c3.changes', 'A changed assumption changes the recommendation')}
              </li>
            </ul>
          </>
        ) : (
          <NotYet />
        )
      }
    >
      {c3 ? (
        <div className="proof-stack">
          <div className="table-scroll">
            <table className="table table-compact proof-table">
              <caption className="visually-hidden">{t('checks.c3.caption', 'The order with the missing refund')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('checks.col.order', 'Order')}</th>
                  <th scope="col">{t('checks.col.refund', 'Refund')}</th>
                  <th scope="col">{t('checks.col.status', 'Status')}</th>
                  <th scope="col">{t('checks.col.total', 'Period total')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">{unknownOrder}</th>
                  <td className="muted">{t('checks.c3.missing', 'missing in the file')}</td>
                  <td>
                    <Pill tone="unknown">{result?.status === 'unknown' || !result ? t('checks.c3.unknown', 'Unknown') : result.status}</Pill>
                  </td>
                  <td>{totalLabel ? <code className="proof-code">{totalLabel}</code> : <span className="muted">{t('checks.notAvailable', 'Not available yet')}</span>}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <fieldset className="proof-scenario" aria-describedby="proof-scenario-note">
            <legend className="proof-scenario-legend">
              <Icon name="sliders" size={16} />
              {t('checks.c3.assume', 'Mini scenario: assume returns')}
            </legend>
            <div className="proof-rates" role="radiogroup" aria-label={t('checks.c3.assumeAria', 'Assumed return rate')}>
              {values.map((v) => (
                <label key={v} className={`proof-rate${v === rate ? ' is-on' : ''}`}>
                  <input type="radio" name="proof-rate" value={v} checked={v === rate} onChange={() => setRate(v)} />
                  <span>
                    {`${v}%`}
                    {control?.observed === v ? <span className="proof-rate-obs">{t('checks.c3.observed', 'observed')}</span> : null}
                  </span>
                  {control?.changing.includes(v) ? <span className="proof-rate-dot" title={t('checks.c3.flips', 'Changes the recommendation')} /> : null}
                </label>
              ))}
            </div>
            <p id="proof-scenario-note" className="proof-source">
              {t('checks.c3.note', 'Re-runs the engine on the missing-refund sample with this one assumption. Nothing is saved.')}
              {control?.changing.length ? (
                <>
                  {' '}
                  <span className="proof-rate-dot is-inline" aria-hidden="true" /> {t('checks.c3.flipsLegend', 'changes the recommendation itself; other rates change only the amount.')}
                </>
              ) : null}
            </p>

            {state === 'missing' ? (
              <Callout tone="info" title={t('checks.c3.notYet', 'The mini scenario is not available from this API yet.')}>
                <p className="callout-hint">{t('checks.c3.fallback', 'Shown instead: the result from the checks run, with recovery assumed at 50%.')}</p>
              </Callout>
            ) : null}
            {state === 'error' && error ? <Callout tone="danger" title={error} /> : null}

            <div className={`proof-flip${state === 'loading' ? ' is-refreshing' : ''}`} aria-live="polite">
              <Outcome heading={t('checks.c3.before', 'Before: no assumption')} o={before} tone="before" />
              <span className="proof-flip-arrow" aria-hidden="true">
                <Icon name="arrow-right" size={18} />
              </span>
              <Outcome
                heading={live && label ? label : state === 'missing' ? t('checks.c3.recovery50', 'Scenario: assumes 50% recovery') : t('checks.c3.scenarioLabel', 'Scenario: assumes {{x}}% returns', { x: rate })}
                o={after}
                tone="after"
              />
            </div>
            {result?.assumptions?.length ? (
              <ul className="proof-assumptions">
                {result.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
            <div className="proof-flip-foot">
              {label ? <Pill tone="primary">{label}</Pill> : null}
              {changed === null ? null : changed ? (
                <Pill tone="success" icon="check">
                  {t('checks.c3.changed', 'Recommendation changed')}
                </Pill>
              ) : (
                <Pill tone="neutral">{t('checks.c3.same', 'Same recommendation')}</Pill>
              )}
            </div>
          </fieldset>
        </div>
      ) : (
        <NotYet />
      )}
    </CheckCard>
  );
}

// ---- Check 4 ----------------------------------------------------------------------------

function Check4({ data }: { data: ProofChecks }) {
  const { t } = useTranslation();
  const c4 = data.check4;
  const rows = c4
    ? [
        { key: 'net_revenue' as const, label: t('checks.c4.netRevenue', 'Net revenue'), value: formatInr(c4.net_revenue_inr) },
        { key: 'cm1' as const, label: t('checks.c4.cm1', 'Gross margin (CM1)'), value: formatPct2(c4.cm1_pct) },
        { key: 'cm2' as const, label: t('checks.c4.cm2', 'CM2, after fulfilment'), value: formatPct2(c4.cm2_pct) },
        { key: 'cm3' as const, label: t('checks.c4.cm3', 'Contribution margin (CM3)'), value: formatPct2(c4.cm3_pct) },
      ]
    : [];
  return (
    <CheckCard
      id="check4"
      n={4}
      kicker={t('checks.c4.kicker', 'Margins')}
      title={t('checks.c4.title', 'Margins on the worked order, each with its formula')}
      pass={c4 ? c4.pass : null}
      aside={
        c4 ? (
          <>
            <BigValue
              value={formatPct2(c4.cm3_pct)}
              sub={t('checks.c4.sub', 'Contribution margin on net revenue of {{value}}', { value: formatInr(c4.net_revenue_inr) })}
              tone="gain"
            />
            <p className="proof-text">
              {t('checks.c4.text', 'Net revenue is revenue less the refund. Each margin divides by net revenue, so the percentages describe what the order kept, not what it billed.')}
            </p>
          </>
        ) : (
          <NotYet />
        )
      }
    >
      {c4 ? (
        <div className="table-scroll">
          <table className="table table-compact proof-table">
            <caption className="visually-hidden">{t('checks.c4.caption', 'Margins on the worked order')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('checks.col.metric', 'Metric')}</th>
                <th scope="col" className="r">
                  {t('checks.col.value', 'Value')}
                </th>
                <th scope="col">{t('checks.col.formula', 'Formula')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const formula = readFormula(c4.formulas, r.key);
                return (
                  <tr key={r.key}>
                    <th scope="row">{r.label}</th>
                    <td className="r num proof-strong">{r.value}</td>
                    <td className="cell-wrap">
                      {formula ? <code className="proof-code">{formula}</code> : <span className="muted">{t('checks.c4.noFormula', 'Formula not sent')}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <NotYet>{t('checks.c4.notYet', 'Check 4 is not available from this API yet. It will show net revenue ₹800, gross margin 50%, CM2 41.25% and contribution margin 28.75%, each with its formula.')}</NotYet>
      )}
    </CheckCard>
  );
}

// ---- Screen -----------------------------------------------------------------------------

export function ChecksScreen() {
  const { t, i18n } = useTranslation();
  const { analysis, refreshChecks, openChecks } = useStore();
  const [data, setData] = useState<ProofChecks | null>(null);
  const [worked, setWorked] = useState<WorkedOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ranAt, setRanAt] = useState<Date | null>(null);
  const [runId, setRunId] = useState(0);
  const seq = useRef(0);

  const run = useCallback(
    async (again: boolean) => {
      const id = ++seq.current;
      setLoading(true);
      setError(null);
      if (again) {
        setRunId((n) => n + 1);
        void refreshChecks();
      }
      try {
        const c = await fetchChecks();
        const w = Array.isArray(c.check1?.lines) ? null : await fetchWorkedOrder().catch(() => null);
        if (id !== seq.current) return;
        setData(c);
        setWorked(w);
        setRanAt(new Date());
      } catch (err) {
        if (id !== seq.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [refreshChecks],
  );

  useEffect(() => {
    void run(false);
  }, [run]);

  const results = checkResults(data);
  const byId = new Map(results.map((r) => [r.id, r.pass]));
  const total = Math.max(CHECK_IDS.length, results.length);
  const passed = results.filter((r) => r.pass).length;
  const allPass = data !== null && passed === total;
  const anyFail = results.some((r) => !r.pass);
  const tone = allPass ? 'is-pass' : anyFail ? 'is-fail' : 'is-partial';
  const names: Record<CheckId, string> = {
    check1: t('checks.c1.kicker', 'Worked order'),
    check2: t('checks.c2.kicker', 'Reconciliation'),
    check3: t('checks.c3.kicker', 'Missing refund'),
    check4: t('checks.c4.kicker', 'Margins'),
  };
  const locale = localeFor(i18n.language);

  const jump = (id: CheckId) => {
    const el = document.getElementById(`proof-${id}`);
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  };

  return (
    <div className="page proof-page">
      <PageHeader
        title={t('checks.title', 'Checks')}
        subtitle={t('checks.subtitle', 'Each check re-runs the engine on the reference data and shows its working, not just the result.')}
        actions={
          <>
            <Button variant="ghost" size="sm" icon="info" onClick={openChecks}>
              {t('checks.openPanel', 'Quick panel')}
            </Button>
            <ButtonLink variant="secondary" size="sm" icon="file" href="/api/v1/checks" target="_blank" rel="noreferrer">
              {t('checks.viewJson', 'View JSON')}
            </ButtonLink>
            <Button variant="primary" size="sm" icon="refresh" onClick={() => void run(true)} disabled={loading}>
              {loading && data ? t('checks.running', 'Running…') : t('checks.runAgain', 'Run again')}
            </Button>
          </>
        }
      />

      {error ? (
        <Callout tone="danger" title={t('checks.loadError', 'The checks could not be run.')} role="alert">
          <p className="callout-hint">{error}</p>
        </Callout>
      ) : null}

      {!data && loading ? (
        <div className="proof-skeleton" role="status" aria-label={t('checks.loading', 'Running the checks')}>
          <div className="card pad">
            <Skeleton width="40%" height={28} />
            <Skeleton width="60%" height={14} className="skeleton-gap" />
          </div>
          {CHECK_IDS.map((id) => (
            <div key={id} className="card skeleton-block" aria-hidden="true" />
          ))}
        </div>
      ) : null}

      {data ? (
        <div className={`proof-stack-lg${loading ? ' is-refreshing' : ''}`}>
          <section className={`card proof-summary ${tone}`} aria-labelledby="proof-summary-title">
            <div className="proof-summary-main">
              <span className="proof-summary-icon" aria-hidden="true">
                <Icon name={allPass ? 'check-circle' : anyFail ? 'alert-triangle' : 'info'} size={28} />
              </span>
              <div>
                <h2 id="proof-summary-title" className="proof-summary-title">
                  {t('checks.summary', '{{passed}} of {{total}} checks pass', { passed, total })}
                </h2>
                {!allPass && !anyFail ? (
                  <p className="proof-summary-meta">{t('checks.partialNote', 'No check fails; the ones marked not available yet are not sent by this API version.')}</p>
                ) : null}
                <p className="proof-summary-meta">
                  {data.engine_version ? t('checks.engine', 'Engine {{version}}', { version: data.engine_version }) : null}
                  {typeof data.ms === 'number' ? <> · {t('checks.computed', 'computed in {{ms}} ms', { ms: data.ms })}</> : null}
                  {ranAt ? (
                    <>
                      {' '}
                      · {t('checks.ranAt', 'run at {{time}}', { time: ranAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) })}
                    </>
                  ) : null}
                </p>
              </div>
            </div>
            <ol className="proof-summary-list">
              {CHECK_IDS.map((id, i) => {
                const pass = byId.has(id) ? byId.get(id)! : null;
                return (
                  <li key={id}>
                    <button type="button" className={`proof-chip ${pass === null ? 'is-na' : pass ? 'is-pass' : 'is-fail'}`} onClick={() => jump(id)}>
                      <span className="proof-chip-icon" aria-hidden="true">
                        <Icon name={pass === null ? 'info' : pass ? 'check' : 'x'} size={13} strokeWidth={2.5} />
                      </span>
                      <span className="proof-chip-text">
                        <span className="proof-chip-n">{t('checks.checkN', 'Check {{n}}', { n: i + 1 })}</span>
                        <span className="proof-chip-name">{names[id]}</span>
                      </span>
                      <span className="visually-hidden">
                        {pass === null ? t('checks.notAvailable', 'Not available yet') : pass ? t('checks.pass', 'PASS') : t('checks.fail', 'FAIL')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          <Check1 data={data} worked={worked} />
          <Check2 data={data} currentMode={analysis?.attribution ?? 'allocate'} />
          <Check3 data={data} runId={runId} />
          <Check4 data={data} />

          <p className="proof-foot">
            {t('checks.foot', 'The JSON at /api/v1/checks is the same run, untranslated, and needs no login. Expected values live in data/expected.json.')}{' '}
            <a href={hrefFor('changelog')}>{t('checks.changelogLink', 'How we got here: the change log')}</a>
          </p>
        </div>
      ) : null}
    </div>
  );
}
