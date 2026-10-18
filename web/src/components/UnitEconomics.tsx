import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnalysisResponse, GroupRow, LineKey, Margins, OrderResult } from '../api/types';
import { ChartTable, CsvButton } from '../charts/ChartCard';
import { MarginBridge, type BridgeStep } from '../charts/MarginBridge';
import { lower } from '../i18n';
import { formatCount, formatInr, formatMarginPct } from '../lib/format';
import { ALLOCATED_EN, ALLOCATED_KEY, handlingEstimateUsed } from '../lib/labels';
import { useStore } from '../state/store';
import { Pill } from './Badge';
import { Popover } from './Definitions';
import { Money } from './Money';
import { Provenance, ProvenanceValue, type ProvenanceKind } from './Provenance';

// ---- Pure computation -------------------------------------------------------------------------

export interface UnitEconomicsFigures {
  netRevenue: number | null;
  /** Rupees left after each step: CM1 = after net product cost, CM2 = after shipping, fees and handling, CM3 = after ads. */
  cm1Inr: number | null;
  cm2Inr: number | null;
  cm3Inr: number | null;
  netInr: number | null;
  cm1Pct: number | null;
  cm2Pct: number | null;
  cm3Pct: number | null;
  netPct: number | null;
  fixedCosts: number;
}

/** Outbound and return shipping together, as the CM2 formula reads. */
export function shippingOf(m: Margins): number | null {
  if (m.shipping_inr === null || m.return_cost_inr === null) return null;
  return m.shipping_inr + (m.return_cost_inr ?? 0);
}

const pctOf = (part: number | null, whole: number | null): number | null =>
  part === null || whole === null || whole <= 0 ? null : Math.round((part / whole) * 10000) / 100;

const minus = (a: number | null, ...bs: Array<number | null>): number | null => (a === null || bs.some((b) => b === null) ? null : bs.reduce<number>((s, b) => s - (b as number), a));

/**
 * The five unit-economics figures from one margins block and the fixed costs (₹ per period, an assumption).
 * Worked order (revenue 1,000, refund 200, net product cost 400, shipping 50, handling 20, ads 100, fixed 0):
 * 800 · 50% · 41.25% · 28.75% · 28.75%.
 */
export function unitEconomics(m: Margins, fixedCosts = 0): UnitEconomicsFigures {
  const rev = m.net_revenue_inr;
  const cm1Inr = minus(rev, m.net_product_cost_inr);
  const cm2Inr = minus(cm1Inr, shippingOf(m), m.payment_fee_inr, m.handling_inr);
  const cm3Computed = minus(cm2Inr, m.ads_inr);
  const cm3Inr = m.contribution_inr ?? cm3Computed;
  const fixed = Number.isFinite(fixedCosts) && fixedCosts > 0 ? fixedCosts : 0;
  const netInr = cm3Inr === null ? null : cm3Inr - fixed;
  return {
    netRevenue: rev,
    cm1Inr,
    cm2Inr,
    cm3Inr,
    netInr,
    cm1Pct: m.cm1_pct ?? pctOf(cm1Inr, rev),
    cm2Pct: m.cm2_pct ?? pctOf(cm2Inr, rev),
    cm3Pct: m.cm3_pct ?? pctOf(cm3Inr, rev),
    netPct: pctOf(netInr, rev),
    fixedCosts: fixed,
  };
}

const line = (o: OrderResult, k: LineKey): number => -(o.lines.find((l) => l.key === k)?.amount_inr ?? 0);

/** Margins summed from computed orders, for analyses that predate the API's margins block. */
function deriveMargins(orders: OrderResult[], allOrders: number, adsOverride: number | null): Margins {
  const ok = orders.filter((o) => o.status === 'ok' && o.contribution_inr !== null);
  const sum = (f: (o: OrderResult) => number) => ok.reduce((s, o) => s + f(o), 0);
  const net = sum((o) => o.net_sales_inr ?? 0);
  const npc = sum((o) => line(o, 'net_product_cost'));
  const ship = sum((o) => line(o, 'shipping'));
  const returnCost = sum((o) => line(o, 'return_cost'));
  const fee = sum((o) => line(o, 'payment_fee'));
  const handling = sum((o) => line(o, 'handling'));
  const ads = adsOverride ?? sum((o) => line(o, 'ads'));
  const contribution = net - npc - ship - returnCost - fee - handling - ads;
  return {
    net_revenue_inr: net,
    net_product_cost_inr: npc,
    shipping_inr: ship,
    return_cost_inr: returnCost,
    payment_fee_inr: fee,
    handling_inr: handling,
    ads_inr: ads,
    contribution_inr: ok.length ? contribution : null,
    cm1_pct: null,
    cm2_pct: null,
    cm3_pct: null,
    orders_counted: ok.length,
    partial: ok.length < allOrders,
  };
}

/** The period's margins: the API's block when present, else summed from the orders (same rules, same lines). */
export function marginsOf(a: AnalysisResponse): Margins {
  if (a.margins) return a.margins;
  // Channel mode moves ads off the orders; the period's ads are then the channel spend, deducted once.
  const spend = a.attribution === 'channel' ? a.totals.channel_spend_inr ?? 0 : null;
  return deriveMargins(a.orders, a.orders.length, spend);
}

/** One channel or product row's margins. In channel mode a channel carries its spend; products stay before spend. */
export function groupMarginsOf(a: AnalysisResponse, row: GroupRow, kind: 'channel' | 'product'): Margins {
  if (row.margins) return row.margins;
  const orders = a.orders.filter((o) => (kind === 'channel' ? o.channel : o.product_id) === row.key);
  const spend = kind === 'channel' && a.attribution === 'channel' ? row.channel_spend_inr ?? 0 : null;
  return deriveMargins(orders, row.orders, spend);
}

/** Fixed costs are a period figure; a row carries its share by net revenue (an assumption, labelled as such). */
export function rowFixedShare(fixedCosts: number, rowRevenue: number | null, totalRevenue: number | null): number {
  if (!fixedCosts || rowRevenue === null || totalRevenue === null || totalRevenue <= 0 || rowRevenue <= 0) return 0;
  return (fixedCosts * rowRevenue) / totalRevenue;
}

// ---- Formulas ---------------------------------------------------------------------------------

export type MetricId = 'revenue' | 'cm1' | 'cm2' | 'cm3' | 'net';

export function useFormulas(): Record<MetricId, { label: string; short: string; formula: string }> {
  const { t } = useTranslation();
  return {
    revenue: {
      label: t('unit.netRevenue', 'Net revenue'),
      short: t('unit.netRevenue', 'Net revenue'),
      formula: t('unit.netRevenueFormula', 'Net revenue = revenue − refunds (revenue is gross sales after discount)'),
    },
    cm1: {
      label: t('unit.cm1', 'Gross margin % (CM1)'),
      short: t('unit.cm1Short', 'Gross margin %'),
      formula: t('unit.cm1Formula', 'CM1 = (net revenue − net product cost) ÷ net revenue, where net product cost = product cost − recovered'),
    },
    cm2: {
      label: t('unit.cm2', 'After shipping and fees (CM2)'),
      short: t('unit.cm2Short', 'CM2 %'),
      formula: t('unit.cm2Formula', 'CM2 = (net revenue − net product cost − shipping − payment fees − handling) ÷ net revenue; shipping includes return shipping'),
    },
    cm3: {
      label: t('unit.cm3', 'Contribution margin % (CM3, operating)'),
      short: t('unit.cm3Short', 'CM3 %'),
      formula: t('unit.cm3Formula', 'CM3 = (net revenue − net product cost − shipping − payment fees − handling − ads) ÷ net revenue; ads are allocated, not caused'),
    },
    net: {
      label: t('unit.net', 'Net margin % (estimated)'),
      short: t('unit.netShort', 'Net margin % (est.)'),
      formula: t('unit.netFormula', 'Net margin = (operational contribution − fixed costs) ÷ net revenue'),
    },
  };
}

// ---- Bridge -------------------------------------------------------------------------------------

/**
 * Net revenue → CM1 → CM2 → CM3 → net as bridge steps: each deduction drops from the running figure,
 * each margin is drawn from ₹0. Steps with an unknown figure stop the bridge there.
 */
export function marginBridgeSteps(
  u: UnitEconomicsFigures,
  labels: { revenue: string; npc: string; cm1: string; costs: string; cm2: string; ads: string; cm3: string; fixed: string; net: string },
  notes: { ads: string; fixed: string },
): BridgeStep[] {
  const rev = u.netRevenue;
  if (rev === null) return [];
  const steps: BridgeStep[] = [{ key: 'revenue', label: labels.revenue, kind: 'start', from: 0, to: rev }];
  const add = (key: string, dropLabel: string, from: number, to: number | null, subKey: string, subLabel: string, pct: number | null, note?: string) => {
    if (to === null) return false;
    steps.push({ key, label: dropLabel, kind: 'drop', from, to, note });
    steps.push({ key: subKey, label: subLabel, kind: 'subtotal', from: 0, to, pct });
    return true;
  };
  if (!add('npc', labels.npc, rev, u.cm1Inr, 'cm1', labels.cm1, u.cm1Pct)) return steps;
  if (!add('costs', labels.costs, u.cm1Inr as number, u.cm2Inr, 'cm2', labels.cm2, u.cm2Pct)) return steps;
  if (!add('ads', labels.ads, u.cm2Inr as number, u.cm3Inr, 'cm3', labels.cm3, u.cm3Pct, notes.ads)) return steps;
  if (u.fixedCosts > 0 && u.netInr !== null) add('fixed', labels.fixed, u.cm3Inr as number, u.netInr, 'net', labels.net, u.netPct, notes.fixed);
  return steps;
}

// ---- Panel ------------------------------------------------------------------------------------

function Tile({
  id,
  label,
  formula,
  worked,
  value,
  amount,
  provenance,
  chips,
  note,
  tone,
}: {
  id: MetricId;
  label: string;
  formula: string;
  worked: ReactNode;
  value: ReactNode;
  amount?: ReactNode;
  provenance: ProvenanceKind;
  chips?: ReactNode;
  note?: ReactNode;
  tone?: 'primary' | 'estimate';
}) {
  const { t } = useTranslation();
  return (
    <div className={`ue-tile${tone ? ` ue-tile-${tone}` : ''}`} title={formula} data-metric={id}>
      <span className="ue-head">
        <span className="ue-label">{label}</span>
        <Popover label={t('unit.howComputed', 'How {{metric}} is computed', { metric: label })} title={label}>
          <span className="popover-formula">{formula}</span>
          <span className="popover-worked num">{worked}</span>
        </Popover>
      </span>
      <span className="ue-value num">{value}</span>
      {amount ? <span className="ue-amount">{amount}</span> : null}
      {note ? <span className="ue-note">{note}</span> : null}
      <span className="ue-sub">
        <ProvenanceValue kind={provenance} chips={chips} />
      </span>
    </div>
  );
}

const pctText = (v: number | null) => (v === null ? '—' : formatMarginPct(v));
const inrText = (v: number | null) => (v === null ? '—' : formatInr(v));

function FixedCostsField() {
  const { fixedCosts, setFixedCosts } = useStore();
  const { t } = useTranslation();
  const [draft, setDraft] = useState(fixedCosts > 0 ? String(fixedCosts) : '0');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(fixedCosts > 0 ? String(fixedCosts) : '0');
  }, [fixedCosts, focused]);
  const n = draft.trim() === '' ? 0 : Number(draft);
  const invalid = !Number.isFinite(n) || n < 0;
  return (
    <div className="ue-fixed">
      <label htmlFor="ue-fixed-costs" className="ue-fixed-label">
        {t('unit.fixedCosts', 'Fixed costs (salaries, rent, tools)')}
      </label>
      <span className="ue-fixed-row">
        <span className="num-field">
          <span className="num-affix" aria-hidden="true">
            ₹
          </span>
          <input
            id="ue-fixed-costs"
            type="number"
            inputMode="decimal"
            min={0}
            step={1000}
            value={draft}
            aria-invalid={invalid || undefined}
            aria-describedby="ue-fixed-hint"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setDraft(e.target.value);
              const v = e.target.value.trim() === '' ? 0 : Number(e.target.value);
              if (Number.isFinite(v) && v >= 0) setFixedCosts(v);
            }}
          />
          <span className="num-affix" aria-hidden="true">
            {t('unit.perPeriod', '/ period')}
          </span>
        </span>
        <Provenance kind="assumed" title={t('unit.fixedTip', 'Assumed: entered by you, kept in this browser, and saved with a decision.')} />
      </span>
      <span id="ue-fixed-hint" className="visually-hidden">
        {t('unit.fixedHint', 'Rupees per period. Used only for the estimated net margin.')}
      </span>
    </div>
  );
}

/** Ledger: net revenue, CM1, CM2, CM3 and the estimated net margin, each with its formula and provenance. */
export const UnitEconomics = memo(function UnitEconomics({ a }: { a: AnalysisResponse }) {
  const { fixedCosts, correctedOrderIds } = useStore();
  const { t } = useTranslation();
  const f = useFormulas();
  const m = useMemo(() => marginsOf(a), [a]);
  const correctedCount = (correctedOrderIds ?? []).length;
  const correctedChip =
    correctedCount > 0 ? (
      <Provenance kind="corrected" title={t('unit.correctedTip', 'Includes {{n}} orders with values you corrected on the import report.', { n: correctedCount })} />
    ) : null;
  const u = unitEconomics(m, fixedCosts);
  const unknown = Math.max(0, a.orders.length - m.orders_counted);
  const synthetic = a.orders.some((o) => o.synthetic);
  const estimated = handlingEstimateUsed(a);

  const partialChip =
    m.partial && unknown > 0 ? (
      <Pill tone="warning" title={t('unit.partialTip', 'Partial: {{n}} unknown orders are left out, never counted as zero.', { n: unknown })}>
        {formatCount(unknown)} {lower(t('status.unknown'))}
      </Pill>
    ) : null;
  const syntheticChip = synthetic ? <Pill tone="teal">{lower(t('status.syntheticTag'))}</Pill> : null;
  const estimatedChip = estimated ? (
    <Pill tone="warning" title={t('unit.handlingTip', 'Handling includes {{inr}} per order, estimated for rows without handling_inr.', { inr: formatInr(a.config.handling_default_inr) })}>
      {lower(t('status.estimated'))}
    </Pill>
  ) : null;
  const chips = (
    <>
      {correctedChip}
      {partialChip}
      {syntheticChip}
    </>
  );
  const costChips = (
    <>
      {correctedChip}
      {estimatedChip}
      {partialChip}
      {syntheticChip}
    </>
  );

  const r = inrText(u.netRevenue);
  const steps = marginBridgeSteps(
    u,
    {
      revenue: f.revenue.label,
      npc: t('chart.bridgeNpc', 'Net product cost'),
      cm1: t('chart.bridgeCm1', 'CM1 · gross margin'),
      costs: t('chart.bridgeCosts', 'Shipping, fees and handling'),
      cm2: t('chart.bridgeCm2', 'CM2 · after shipping and fees'),
      ads: t('ledger.ads'),
      cm3: t('chart.bridgeCm3', 'CM3 · operational contribution'),
      fixed: t('chart.bridgeFixed', 'Fixed costs'),
      net: t('chart.bridgeNet', 'Net (estimated)'),
    },
    { ads: t(ALLOCATED_KEY, ALLOCATED_EN), fixed: lower(t('provenance.assumed')) },
  );
  const bridgeTitle = t('chart.bridgeTitle', 'From net revenue to contribution');
  const bridgeCsv = {
    filename: 'unit-economics-bridge.csv',
    headers: ['step', 'kind', 'from_inr', 'to_inr', 'change_inr', 'pct_of_net_revenue'],
    rows: steps.map((s) => [s.key, s.kind, s.from, s.to, s.kind === 'drop' ? s.to - s.from : s.to, s.pct ?? null]),
  };
  return (
    <section className="card ue-card" aria-labelledby="ue-title">
      <div className="ue-top">
        <div>
          <h2 id="ue-title" className="card-title">
            {t('unit.title', 'Unit economics')}
          </h2>
          <p className="card-sub">
            {t('unit.sub', 'Per period, over {{n}} computed orders. Percentages are of net revenue.', { n: formatCount(m.orders_counted) })}{' '}
            {a.attribution === 'channel'
              ? t('unit.subChannel', 'Ads are the channel spend, deducted once per channel.')
              : t('unit.subAllocate', 'Ads are allocated per order.')}
            {a.headline_gate.open ? null : (
              <>
                {' '}
                {t('unit.gateClosed', 'Unknown orders are left out, so these cover computed orders only; the headline margin stays hidden until refund facts are complete.')}
              </>
            )}
          </p>
        </div>
        <FixedCostsField />
      </div>
      <div className="ue-grid">
        <Tile
          id="revenue"
          label={f.revenue.label}
          formula={f.revenue.formula}
          worked={`= ${r}`}
          value={inrText(u.netRevenue)}
          amount={t('unit.revenueSub', 'revenue − refunds')}
          provenance="observed"
          chips={chips}
        />
        <Tile
          id="cm1"
          label={f.cm1.label}
          formula={f.cm1.formula}
          worked={`(${r} − ${inrText(m.net_product_cost_inr)}) ÷ ${r} = ${pctText(u.cm1Pct)}`}
          value={pctText(u.cm1Pct)}
          amount={<Money value={u.cm1Inr} tone="contribution" />}
          provenance="observed"
          chips={chips}
        />
        <Tile
          id="cm2"
          label={f.cm2.label}
          formula={f.cm2.formula}
          worked={`(${inrText(u.cm1Inr)} − ${inrText(shippingOf(m))} − ${inrText(m.payment_fee_inr)} − ${inrText(m.handling_inr)}) ÷ ${r} = ${pctText(u.cm2Pct)}`}
          value={pctText(u.cm2Pct)}
          amount={<Money value={u.cm2Inr} tone="contribution" />}
          provenance="observed"
          chips={costChips}
        />
        <Tile
          id="cm3"
          tone="primary"
          label={f.cm3.label}
          formula={f.cm3.formula}
          worked={`(${inrText(u.cm2Inr)} − ${inrText(m.ads_inr)}) ÷ ${r} = ${pctText(u.cm3Pct)}`}
          value={pctText(u.cm3Pct)}
          amount={
            <>
              <Money value={u.cm3Inr} tone="contribution" /> {lower(t('ledger.operationalContribution', 'Operational contribution'))}
            </>
          }
          provenance="observed"
          chips={costChips}
          note={
            <>
              {t('unit.adsLine', 'Ads {{inr}}', { inr: inrText(m.ads_inr) })} · {t(ALLOCATED_KEY, ALLOCATED_EN)}
            </>
          }
        />
        <Tile
          id="net"
          tone="estimate"
          label={f.net.label}
          formula={f.net.formula}
          worked={`(${inrText(u.cm3Inr)} − ${formatInr(u.fixedCosts)}) ÷ ${r} = ${pctText(u.netPct)}`}
          value={pctText(u.netPct)}
          amount={
            <>
              <Money value={u.netInr} tone="contribution" /> {t('unit.afterFixed', 'after {{inr}} fixed costs', { inr: formatInr(u.fixedCosts) })}
            </>
          }
          provenance="assumed"
          chips={costChips}
          note={t('unit.disclaimer', 'Estimated operational, not statutory net profit.')}
        />
      </div>
      {steps.length > 1 ? (
        <>
          <div className="mb-head">
            <h3 className="section-label">{bridgeTitle}</h3>
            <CsvButton csv={bridgeCsv} title={bridgeTitle} />
          </div>
          <MarginBridge steps={steps} ariaLabel={bridgeTitle} />
          <details className="chart-table">
            <summary>{t('chart.tableView', 'Table view')}</summary>
            <ChartTable
              caption={bridgeTitle}
              headers={[t('chart.step', 'Step'), t('chart.amount', 'Amount'), t('chart.pctOfRevenue', '% of net revenue')]}
              rows={steps.map((s) => ({
                key: s.key,
                cells: [
                  `${s.kind === 'drop' ? '− ' : s.kind === 'subtotal' ? '= ' : ''}${s.label}`,
                  s.kind === 'drop' ? `−${formatInr(Math.abs(s.to - s.from))}` : formatInr(s.to),
                  typeof s.pct === 'number' ? formatMarginPct(s.pct) : '—',
                ],
              }))}
            />
          </details>
        </>
      ) : null}
    </section>
  );
});
