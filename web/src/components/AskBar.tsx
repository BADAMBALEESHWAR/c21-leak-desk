import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { askProfyn } from '../lib/ask';
import { Icon } from './Icon';

/** An always-visible question box on the Overview: type or tap a suggestion, and the Ask Profyn drawer answers from the owner's own data. */
export function AskBar() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const suggestions = [
    t('ask.q1', 'Which product lost most in September?'),
    t('ask.q2', 'What if return shipping is charged?'),
    t('ask.q3', 'Why is Instagram negative?'),
  ];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    askProfyn(text);
    setQ('');
  };
  return (
    <section className="ask-bar" aria-label={t('askbar.title', 'Ask Profyn')}>
      <form className="ask-bar-form" onSubmit={submit}>
        <span className="ask-bar-icon" aria-hidden="true">
          <Icon name="sparkles" size={18} />
        </span>
        <input
          className="ask-bar-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('askbar.placeholder', 'Ask anything about your orders, in English, Hindi or Telugu…')}
          aria-label={t('askbar.input', 'Your question')}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!q.trim()}>
          {t('askbar.send', 'Ask AI')}
        </button>
      </form>
      <div className="ask-bar-chips">
        {suggestions.map((s) => (
          <button key={s} type="button" className="ask-bar-chip" onClick={() => askProfyn(s)}>
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}
