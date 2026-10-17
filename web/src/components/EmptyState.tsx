import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toErrorInfo, type ErrorInfo } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { hrefFor } from '../lib/router';
import { useStore } from '../state/store';
import { Button, ButtonLink } from './Button';
import type { IconName } from './Icon';
import { EmptyPanel, ErrorCallout, SkeletonCards } from './ui';

/** Shown on steps that need an analysis before there is one; a skeleton while one loads. */
export function NeedsAnalysis({ sentence, icon = 'table' }: { sentence: string; icon?: IconName }) {
  const { importDataset, runAnalysis, restoring, analysing, importing, workspace } = useStore();
  const { mode } = useAuth();
  const { t } = useTranslation();
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

  // Workspace mode never loads samples into the owner's account: the way forward is their own data.
  if (mode === 'account') {
    const hasSaved = (workspace?.datasets.length ?? 0) > 0;
    return (
      <EmptyPanel
        icon={icon}
        title={sentence}
        actions={
          <ButtonLink variant="primary" href={hrefFor('import')} icon="upload-cloud">
            {hasSaved ? 'Open saved data' : 'Upload your orders'}
          </ButtonLink>
        }
      >
        {hasSaved ? 'Your saved data is listed on the Import step; open one to analyse it.' : 'Upload a CSV or JSON export on the Import step; it is validated and saved to your account.'}
      </EmptyPanel>
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
              {busy ? t('actions.loading') : t('actions.loadFixture')}
            </Button>
            <ButtonLink variant="secondary" href={hrefFor('import')} icon="upload-cloud">
              {t('actions.goToImport')}
            </ButtonLink>
          </>
        }
      >
        The sample loads 20 orders in a second; any file in the same schema works too.
      </EmptyPanel>
      <ErrorCallout error={error} />
    </>
  );
}
