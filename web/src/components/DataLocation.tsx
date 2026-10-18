import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { formatCount } from '../lib/format';

interface DataSummary {
  database: string;
  region: string;
  file_storage: string;
  backups: string;
  counts: { datasets: number; analyses: number; scenarios: number; decisions: number; sign_ins: number; audit_events: number };
}

/** "Where your data lives": the database, the region, file storage, backups, and how many records this account has. */
export function DataLocation() {
  const { t } = useTranslation();
  const [d, setD] = useState<DataSummary | null>(null);
  useEffect(() => {
    let alive = true;
    void api.dataSummary().then((x) => alive && setD(x)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!d) return null;
  const row = (k: string, v: string) => (
    <div className="data-row">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
  const where = d.region === 'ap-south-1' ? t('data.mumbai', 'India, AWS Mumbai (ap-south-1)') : t('data.local', 'This computer (local)');
  return (
    <section className="card" aria-labelledby="profile-data">
      <h2 id="profile-data" className="card-title">
        {t('data.title', 'Where your data lives')}
      </h2>
      <dl className="data-list">
        {row(t('data.database', 'Database'), d.database === 'MongoDB' ? t('data.mongo', 'MongoDB, saved on a server in your region') : t('data.memory', 'In memory (not saved)'))}
        {row(t('data.region', 'Region'), where)}
        {row(t('data.files', 'Uploaded files'), d.file_storage === 's3' ? t('data.s3', 'Amazon S3, private and encrypted') : t('data.disk', 'Local disk'))}
        {row(t('data.backups', 'Backups'), d.backups === 'hourly' ? t('data.hourly', 'Every hour, to S3') : t('data.none', 'None'))}
        {row(t('data.datasets', 'Datasets'), formatCount(d.counts.datasets))}
        {row(t('data.analyses', 'Analyses'), formatCount(d.counts.analyses))}
        {row(t('data.scenarios', 'Scenarios'), formatCount(d.counts.scenarios))}
        {row(t('data.decisions', 'Decisions'), formatCount(d.counts.decisions))}
        {row(t('data.signIns', 'Sign-ins'), formatCount(d.counts.sign_ins))}
        {row(t('data.audit', 'Activity log entries'), formatCount(d.counts.audit_events))}
      </dl>
    </section>
  );
}
