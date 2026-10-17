import { formatInr, formatSignedInr } from '../lib/format';
import { Unknown } from './Badge';

type Tone =
  /** Negative in --loss, everything else in the running text colour. */
  | 'default'
  /** Positive in --gain, negative in --loss (contribution figures). */
  | 'contribution'
  /** No colour at all (deduction amounts shown as positive numbers). */
  | 'plain';

interface Props {
  value: number | null | undefined;
  tone?: Tone;
  signed?: boolean;
  /** Muted when the value is exactly zero. */
  muteZero?: boolean;
  unknownTitle?: string;
}

export function Money({ value, tone = 'default', signed = false, muteZero = false, unknownTitle }: Props) {
  if (value === null || value === undefined) return <Unknown title={unknownTitle} />;
  const text = signed ? formatSignedInr(value) : formatInr(value);
  const zero = Math.round(Math.abs(value) * 100) === 0;
  let cls = 'num';
  if (zero && muteZero) cls += ' muted';
  else if (tone !== 'plain' && value < 0 && !zero) cls += ' t-loss';
  else if (tone === 'contribution' && value > 0 && !zero) cls += ' t-gain';
  return <span className={cls}>{text}</span>;
}

/**
 * A change between two figures, coloured by its effect on contribution:
 * for income lines up is good, for cost lines up is bad.
 */
export function Change({
  value,
  goodWhen,
  format = formatSignedInr,
}: {
  value: number;
  goodWhen: 'up' | 'down';
  format?: (n: number) => string;
}) {
  const zero = Math.round(Math.abs(value) * 100) === 0;
  let cls = 'num';
  if (zero) cls += ' muted';
  else if ((value > 0) === (goodWhen === 'up')) cls += ' t-gain';
  else cls += ' t-loss';
  return <span className={cls}>{format(value)}</span>;
}
