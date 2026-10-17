import { useRef } from 'react';
import type { LeakGroup } from '../api/types';
import { BarRows, type BarRow } from '../charts/BarRows';
import { Pill, SourceTag } from '../components/Badge';
import { ButtonLink } from '../components/Button';
import { NeedsAnalysis } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { NextStep, PageHeader } from '../components/Page';
import { EmptyPanel, revealElement } from '../components/ui';
import { formatInr, plural } from '../lib/format';
import { LEAK_LABELS } from '../lib/labels';
import { hrefFor } from '../lib/router';
import { useStore } from '../state/store';

function LeakCard({ g, why, source, onOpen }: { g: LeakGroup; why: string; source: 'template' | 'ai'; onOpen: (id: string) => void }) {
  const unknown = g.lost_inr === null;
  const more = g.order_ids.length - Math.min(g.order_ids.length, 6);
  return (
    <article className={`card leak-card${unknown ? ' is-unknown' : ''}`} aria-labelledby={`leak-${g.cause}`}>
      <div className="leak-top">
        <span className={`icon-chip ${unknown ? 'icon-chip-warning' : 'icon-chip-danger'}`} aria-hidden="true">
          <Icon name={unknown ? 'alert-triangle' : 'trending-down'} size={20} />
        </span>
        <Pill tone="neutral">
          {g.count} {plural(g.count, 'order', 'orders')}
        </Pill>
      </div>
      <h2 id={`leak-${g.cause}`} className="leak-title">
        {g.label || LEAK_LABELS[g.cause]}
      </h2>
      <p className="leak-amount">
        {unknown ? (
          <>
            <span className="leak-amount-unknown">Unknown</span>
            <span className="leak-amount-sub">amount not computable</span>
          </>
        ) : (
          <>
            <span className="t-loss">{formatInr(g.lost_inr as number)}</span>
            <span className="leak-amount-sub">lost</span>
          </>
        )}
      </p>
      <div className="order-chips" aria-label="Orders in this group">
        {g.order_ids.slice(0, 6).map((id) => (
          <button key={id} type="button" className="order-chip" onClick={() => onOpen(id)} aria-label={`Open the waterfall for ${id}`}>
            {id}
          </button>
        ))}
        {more > 0 ? <span className="muted small">+{more} more</span> : null}
      </div>
      <p className="leak-why">
        {why} <SourceTag source={source} />
      </p>
      <ButtonLink variant="ghost" href={hrefFor('scenario')} iconRight="arrow-right" className="leak-link">
        Simulate a fix
      </ButtonLink>
    </article>
  );
}

export function LeaksScreen() {
  const { analysis, narration, openOrder } = useStore();
  const gridRef = useRef<HTMLDivElement>(null);

  if (!analysis) {
    return (
      <div className="page">
        <PageHeader title="Where contribution leaks" subtitle="Losing orders grouped by their primary cause, largest loss first." />
        <NeedsAnalysis sentence="No analysis yet. Load the sample orders to see which orders lose money and why." icon="alert-triangle" />
      </div>
    );
  }

  const leaks = analysis.leaks;
  const knownLoss = leaks.reduce((s, g) => s + (g.lost_inr ?? 0), 0);
  const orderCount = leaks.reduce((s, g) => s + g.count, 0);
  const anyUnknown = leaks.some((g) => g.lost_inr === null);

  const rows: BarRow[] = leaks.map((g) => ({
    key: g.cause,
    label: g.label || LEAK_LABELS[g.cause],
    sub: `${g.count} ${plural(g.count, 'order', 'orders')}`,
    values: [{ series: 'Lost', value: g.lost_inr, tone: 'loss', text: g.lost_inr === null ? 'unknown' : formatInr(g.lost_inr) }],
  }));

  return (
    <div className="page">
      <PageHeader title="Where contribution leaks" subtitle="Losing orders grouped by their primary cause, largest loss first." />

      {leaks.length === 0 ? (
        <EmptyPanel icon="check-circle" title="No negative-contribution orders in this period." />
      ) : (
        <>
          <section className="card summary-card" aria-label="Loss summary">
            <button
              type="button"
              className="summary-figure summary-figure-btn card-action"
              onClick={() => revealElement(gridRef.current)}
              aria-label={"Contribution lost " + formatInr(knownLoss) + " across " + orderCount + " orders — show the causes"}
            >
              <span className="summary-label">Contribution lost</span>
              <span className="summary-value t-loss">{formatInr(knownLoss)}</span>
              <span className="summary-sub">
                across {orderCount} {plural(orderCount, 'order', 'orders')} in {leaks.length} {plural(leaks.length, 'cause', 'causes')}
              </span>
              {anyUnknown ? (
                <Pill tone="warning" dot>
                  Plus orders whose loss is unknown
                </Pill>
              ) : null}
              <span className="kpi-go" aria-hidden="true">
                <Icon name="arrow-right" size={16} />
              </span>
            </button>
            <div className="summary-chart">
              <h2 className="card-title">₹ lost by cause</h2>
              <BarRows rows={rows} ariaLabel="Rupees lost by cause" labelWidth={210} />
            </div>
          </section>

          <div className="leak-grid reveal-target" ref={gridRef} tabIndex={-1} aria-label="Causes">
            {leaks.map((g) => {
              const ai = narration?.leaks[g.cause];
              const useAi = ai !== undefined && ai.why_source === 'ai';
              return <LeakCard key={g.cause} g={g} why={useAi ? ai.why : g.why} source={useAi ? 'ai' : g.why_source} onOpen={openOrder} />;
            })}
          </div>
        </>
      )}

      <NextStep route="scenario" label="Compare a scenario">
        Change one assumption — recovery, return rate, shipping — and see which fix pays most.
      </NextStep>
    </div>
  );
}
