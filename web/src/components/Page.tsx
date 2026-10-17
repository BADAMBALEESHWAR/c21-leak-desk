import type { ReactNode } from 'react';
import { hrefFor, type Route } from '../lib/router';
import { ButtonLink } from './Button';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

/** The closing card of every screen: one sentence and the next step. */
export function NextStep({ route, label, children }: { route: Route; label: string; children: ReactNode }) {
  return (
    <div className="next-step">
      <p>{children}</p>
      <ButtonLink variant="primary" href={hrefFor(route)} iconRight="arrow-right">
        {label}
      </ButtonLink>
    </div>
  );
}
