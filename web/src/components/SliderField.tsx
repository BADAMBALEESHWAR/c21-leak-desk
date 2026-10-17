import { useEffect, useRef, useState, type ReactNode } from 'react';

function round(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

interface NumberInputProps {
  id: string;
  value: number | null;
  onCommit: (v: number | null) => void;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  places?: number;
  ariaLabel?: string;
  describedBy?: string;
  disabled?: boolean;
}

/**
 * Number box that keeps what the person is typing, commits only valid values,
 * and shows the committed value again on blur. Blank commits null.
 */
export function NumberInput({
  id,
  value,
  onCommit,
  min,
  max,
  step = 1,
  prefix,
  suffix,
  placeholder,
  places = 2,
  ariaLabel,
  describedBy,
  disabled,
}: NumberInputProps) {
  const show = (v: number | null) => (v === null ? '' : String(round(v, places)));
  const [draft, setDraft] = useState(() => show(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(show(value));
  }, [value]); // show() depends only on value and places, which is fixed per field.

  const trimmed = draft.trim();
  const parsed = trimmed === '' ? null : Number(trimmed);
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed < min || parsed > max);

  return (
    <span className={`num-field${disabled ? ' is-disabled' : ''}`}>
      {prefix ? <span className="num-affix" aria-hidden="true">{prefix}</span> : null}
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          const t = e.target.value;
          setDraft(t);
          const s = t.trim();
          if (s === '') {
            onCommit(null);
            return;
          }
          const n = Number(s);
          if (Number.isFinite(n) && n >= min && n <= max) onCommit(n);
        }}
        onBlur={() => {
          focused.current = false;
          setDraft(show(value));
        }}
      />
      {suffix ? <span className="num-affix" aria-hidden="true">{suffix}</span> : null}
    </span>
  );
}

interface SliderFieldProps {
  id: string;
  label: string;
  observed?: ReactNode;
  min: number;
  max: number;
  step: number;
  /** The override; null means the observed value (or each order's own). */
  value: number | null;
  /** Where the slider rests when there is no override. */
  rest: number;
  /** When set, the number box stays blank with this placeholder while there is no override. */
  blankPlaceholder?: string;
  prefix?: string;
  suffix?: string;
  hint?: ReactNode;
  /** No visible heading: the label names both inputs (used inside a titled card). */
  compact?: boolean;
  onChange: (v: number | null) => void;
}

/** Slider and number box pair, both bound to the same override. */
export function SliderField({
  id,
  label,
  observed,
  min,
  max,
  step,
  value,
  rest,
  blankPlaceholder,
  prefix,
  suffix,
  hint,
  compact,
  onChange,
}: SliderFieldProps) {
  const labelId = `${id}-label`;
  const hintId = hint ? `${id}-hint` : undefined;
  const shown = value ?? (blankPlaceholder ? null : rest);
  const sliderValue = Math.min(max, Math.max(min, value ?? rest));

  return (
    <div className={`control${compact ? ' control-compact' : ''}`}>
      {compact ? (
        <span id={labelId} className="visually-hidden">
          {label}
        </span>
      ) : (
        <div className="control-head">
          <label id={labelId} htmlFor={id}>
            {label}
          </label>
          {observed ? <span className="control-observed">{observed}</span> : null}
        </div>
      )}
      <div className="control-row">
        <input
          type="range"
          className="range"
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          aria-labelledby={labelId}
          aria-describedby={hintId}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <NumberInput
          id={id}
          value={shown}
          min={min}
          max={max}
          step={step}
          prefix={prefix}
          suffix={suffix}
          placeholder={blankPlaceholder}
          ariaLabel={compact ? label : undefined}
          describedBy={hintId}
          onCommit={onChange}
        />
      </div>
      {hint ? (
        <p id={hintId} className="control-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
