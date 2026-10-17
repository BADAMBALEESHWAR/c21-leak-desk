import { useStore } from '../state/store';
import { Icon } from './Icon';

/** Bottom-right status message; dismissed after 3 s by the store. */
export function Toast() {
  const { toast } = useStore();
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast ? (
        <p key={toast.id} className={`toast toast-${toast.tone}`}>
          <Icon name={toast.tone === 'info' ? 'info' : 'check-circle'} size={18} />
          {toast.text}
        </p>
      ) : null}
    </div>
  );
}
