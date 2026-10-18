import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

/**
 * Where a figure comes from.
 * Observed: read from the import or the fixture (or computed from those rows alone).
 * Assumed: a scenario override, a default such as the handling estimate, the fixed costs, or assume-unknown-refund.
 */
export type ProvenanceKind = 'observed' | 'assumed' | 'corrected';

export function Provenance({ kind, title, className }: { kind: ProvenanceKind; title?: string; className?: string }) {
  const { t } = useTranslation();
  const text =
    kind === 'observed' ? t('provenance.observed', 'Observed') : kind === 'assumed' ? t('provenance.assumed', 'Assumed') : t('provenance.corrected', 'Corrected');
  const tip =
    title ??
    (kind === 'observed'
      ? t('provenance.observedTip', 'Observed: comes from the imported orders.')
      : kind === 'assumed'
        ? t('provenance.assumedTip', 'Assumed: a scenario change, a default or a value you entered — not measured.')
        : t('provenance.correctedTip', 'Corrected: a value you entered on the import report. The original is kept in the earlier version.'));
  return (
    <span className={['prov', `prov-${kind}`, className].filter(Boolean).join(' ')} title={tip} data-provenance={kind}>
      <Icon name={kind === 'observed' ? 'database' : kind === 'assumed' ? 'sliders' : 'check'} size={11} strokeWidth={2.2} />
      {text}
    </span>
  );
}

/** The provenance badge first, then the value, then any unknown / estimated / synthetic / late-refund chips. */
export function ProvenanceValue({ kind, value, chips, title, className }: { kind: ProvenanceKind; value?: ReactNode; chips?: ReactNode; title?: string; className?: string }) {
  return (
    <span className={['prov-stack', className].filter(Boolean).join(' ')}>
      <Provenance kind={kind} title={title} />
      {value !== undefined && value !== null && value !== '' ? <span className="prov-value">{value}</span> : null}
      {chips}
    </span>
  );
}
