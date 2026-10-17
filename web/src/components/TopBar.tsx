import { useState } from 'react';
import { toErrorInfo, type ErrorInfo } from '../api/client';
import type { AttributionMode } from '../api/types';
import { formatCount } from '../lib/format';
import { ATTRIBUTION_LABEL } from '../lib/labels';
import { hrefFor, type Route } from '../lib/router';
import { useStore } from '../state/store';
import { Button } from './Button';
import { Icon } from './Icon';
import { STEPS } from './Sidebar';
import { AttributionSegmented, InfoTip } from './ui';

const SOURCE_NAMES: Record<string, string> = {
  fixture: 'C21 fixture',
  extended: 'Extended sample',
};

function sourceName(source: string | undefined, label: string | undefined): string {
  if (!source) return 'Dataset';
  if (SOURCE_NAMES[source]) return SOURCE_NAMES[source];
  if (source.startsWith('upload:')) return source.slice('upload:'.length) || 'Upload';
  return label ?? source.replace(/_/g, ' ');
}

const ATTRIBUTION_ROUTES: Route[] = ['ledger', 'leaks', 'scenario'];

export function TopBar({ route, onError }: { route: Route; onError: (e: ErrorInfo | null) => void }) {
  const { dataset, analysis, samples, analysing, runAnalysis, openWorked, dbStatus } = useStore();
  const [switching, setSwitching] = useState(false);
  const step = STEPS.find((s) => s.route === route);

  const source = dataset?.source;
  const name = sourceName(source, samples.find((s) => s.source === source)?.label);
  const orders = analysis ? analysis.totals.orders : dataset?.rows_kept ?? null;
  const synthetic = analysis ? analysis.orders.filter((o) => o.synthetic).length : dataset?.synthetic_rows ?? 0;

  const persisted = analysis?.persisted ?? dataset?.persisted;
  const saved = persisted === undefined ? dbStatus === 'ok' : persisted;

  const onAttribution = async (mode: AttributionMode) => {
    if (!analysis || mode === analysis.attribution) return;
    onError(null);
    setSwitching(true);
    try {
      await runAnalysis(mode, analysis.period_end, analysis.dataset_id, analysis.config.handling_default_inr);
    } catch (err) {
      onError(toErrorInfo(err));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <header className="topbar">
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          <li>
            <a href={hrefFor('import')}>Leak Desk</a>
          </li>
          <li aria-current="page">{step?.label}</li>
        </ol>
      </nav>

      <div className="topbar-actions">
        {orders !== null ? (
          <span className="chip" title="Loaded dataset">
            <span className="chip-dot" aria-hidden="true" />
            <span className="chip-main">{name}</span>
            <span className="chip-extra">
              {' '}
              · {formatCount(orders)} orders{synthetic > 0 ? ` · ${formatCount(synthetic)} synthetic` : ''}
            </span>
          </span>
        ) : null}

        {analysis && ATTRIBUTION_ROUTES.includes(route) ? (
          <span className="topbar-attr">
            <AttributionSegmented value={analysis.attribution} onChange={(m) => void onAttribution(m)} disabled={analysing || switching} compact />
            <InfoTip text={ATTRIBUTION_LABEL} label="About attribution" />
          </span>
        ) : null}

        <Button variant="secondary" size="sm" icon="file" onClick={openWorked}>
          Worked order
        </Button>

        {orders !== null || dbStatus ? (
          <span
            className={`status-pill ${saved ? 'is-saved' : 'is-memory'}`}
            title={saved ? 'Results are saved to MongoDB.' : 'Not saved to the database — results are in memory only.'}
          >
            <Icon name="database" size={14} />
            <span className="status-text">{saved ? 'Saved to MongoDB' : 'In memory'}</span>
          </span>
        ) : null}
      </div>
    </header>
  );
}
