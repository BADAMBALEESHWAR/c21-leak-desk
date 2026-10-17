import type { ErrorInfo } from '../api/client';
import { ErrorCallout } from './ui';

/** An error as the API states it: message, hint, then field issues — as a callout card. */
export function ErrorNote({ error, className }: { error: ErrorInfo | null; className?: string }) {
  return <ErrorCallout error={error} className={className} />;
}
