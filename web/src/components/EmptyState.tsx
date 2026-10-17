import { useState } from 'react';
import { toErrorInfo, type ErrorInfo } from '../api/client';
import { hrefFor } from '../lib/router';
import { useStore } from '../state/store';
import { Button, ButtonLink } from './Button';
import type { IconName } from './Icon';
import { EmptyPanel, ErrorCallout, SkeletonCards } from './ui';

/** Shown on steps that need an analysis before there is one; a skeleton while one loads. */
export function NeedsAnalysis({ sentence, icon = 'table' }: { sentence: string; icon?: IconName }) {
  const { importDataset, runAnalysis, restoring, analysing, importing } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);

  if (restoring || analysing || importing) {
    return (
      <div className="stack" role="status" aria-label="Loading the analysis">
        <SkeletonCards count={4} />
        <div className="card skeleton-block" aria-hidden="true" />
      </div>
    );
  }

  const loadFixture = async () => {
    setBusy(true);
    setError(null);
    try {
      const ds = await importDataset({ source: 'fixture' });
      await runAnalysis('allocate', undefined, ds.dataset_id);
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <EmptyPanel
        icon={icon}
        title={sentence}
        actions={
          <>
            <Button variant="primary" onClick={loadFixture} disabled={busy}>
              {busy ? 'Loading…' : 'Load C21 fixture'}
            </Button>
            <ButtonLink variant="secondary" href={hrefFor('import')} icon="upload-cloud">
              Go to import
            </ButtonLink>
          </>
        }
      >
        The C21 fixture loads 20 reference orders in a second; any file in the same schema works too.
      </EmptyPanel>
      <ErrorCallout error={error} />
    </>
  );
}
