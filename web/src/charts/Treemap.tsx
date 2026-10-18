import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { compactInr } from './scale';
import { ChartTip, useWidth, type TipRow, type TipState } from './ChartCard';

export interface TreemapItem {
  key: string;
  label: string;
  /** Sizes the tile (net sales); items at or below zero are left out. */
  size: number;
  /** Colours the tile on a diverging scale (contribution per unit); null = unknown, neutral. */
  colorValue: number | null;
  tip?: TipRow[];
  href?: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreemapTile<T> extends Rect {
  item: T;
}

function worst(row: number[], side: number): number {
  const s = row.reduce((a, b) => a + b, 0);
  if (s <= 0 || side <= 0) return Infinity;
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
}

/**
 * Squarified treemap (Bruls, Huizing, van Wijk): items laid out largest first, rows kept as close to
 * square as possible. Tile areas are proportional to size; the tiles exactly cover the box.
 */
export function squarify<T extends { size: number }>(items: T[], box: Rect): Array<TreemapTile<T>> {
  const list = items.filter((i) => i.size > 0).sort((a, b) => b.size - a.size);
  const total = list.reduce((s, i) => s + i.size, 0);
  if (total <= 0 || box.w <= 0 || box.h <= 0) return [];
  const scale = (box.w * box.h) / total;
  const areas = list.map((i) => i.size * scale);
  const out: Array<TreemapTile<T>> = [];
  let rect = { ...box };
  let i = 0;
  while (i < list.length) {
    const side = Math.min(rect.w, rect.h);
    const row: number[] = [areas[i]];
    let j = i + 1;
    while (j < list.length && worst([...row, areas[j]], side) <= worst(row, side)) {
      row.push(areas[j]);
      j += 1;
    }
    const rowArea = row.reduce((a, b) => a + b, 0);
    // The last row takes whatever is left, so rounding never leaves a gap.
    const last = j >= list.length;
    if (rect.w >= rect.h) {
      const w = last ? rect.w : rowArea / rect.h;
      let yy = rect.y;
      row.forEach((a, k) => {
        const h = k === row.length - 1 ? rect.y + rect.h - yy : a / w;
        out.push({ x: rect.x, y: yy, w, h, item: list[i + k] });
        yy += h;
      });
      rect = { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h };
    } else {
      const h = last ? rect.h : rowArea / rect.w;
      let xx = rect.x;
      row.forEach((a, k) => {
        const w = k === row.length - 1 ? rect.x + rect.w - xx : a / h;
        out.push({ x: xx, y: rect.y, w, h, item: list[i + k] });
        xx += w;
      });
      rect = { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h };
    }
    i = j;
  }
  return out;
}

/** −3…+3 on a diverging scale around zero; 0 is the neutral midpoint (and unknown). */
export function divergingStep(v: number | null, maxAbs: number): number {
  if (v === null || maxAbs <= 0) return 0;
  const r = v / maxAbs;
  if (Math.abs(r) < 0.04) return 0;
  const s = Math.abs(r) < 0.34 ? 1 : Math.abs(r) < 0.67 ? 2 : 3;
  return r < 0 ? -s : s;
}

interface Props {
  items: TreemapItem[];
  ariaLabel: string;
  /** Formats the colour value for labels and the legend (₹ per unit). */
  formatColor: (n: number) => string;
  colorLabel: string;
  sizeLabel: string;
  height?: number;
}

const GAP = 2;

/**
 * Products as tiles: area = net sales, colour = contribution per unit on a diverging loss–neutral–gain scale.
 * Labels sit inside when they fit; every tile is a link to that product's orders in the ledger.
 */
export function Treemap({ items, ariaLabel, formatColor, colorLabel, sizeLabel, height = 340 }: Props) {
  const { t } = useTranslation();
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [tip, setTip] = useState<TipState | null>(null);
  const W = Math.max(280, width);
  const H = height;
  const tiles = squarify(items, { x: 0, y: 0, w: W, h: H });
  const maxAbs = Math.max(0, ...items.map((i) => Math.abs(i.colorValue ?? 0)));
  const left = items.filter((i) => i.size <= 0).length;

  const tipFor = (tile: TreemapTile<TreemapItem>): TipState => ({
    x: Math.max(0, Math.min(tile.x + tile.w / 2, W - 220)),
    y: Math.min(tile.y + tile.h / 2, H - 60),
    title: tile.item.label,
    rows: [
      { label: sizeLabel, value: compactInr(tile.item.size) },
      { label: colorLabel, value: tile.item.colorValue === null ? t('status.unknown') : formatColor(tile.item.colorValue), tone: (tile.item.colorValue ?? 0) < 0 ? 'loss' : 'gain' },
      ...(tile.item.tip ?? []),
    ],
  });

  return (
    <div className="tm">
      <div className="chart-plot" ref={ref}>
        <svg className="tm-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={ariaLabel}>
          {tiles.map((tile) => {
            const step = divergingStep(tile.item.colorValue, maxAbs);
            const w = Math.max(0, tile.w - GAP);
            const h = Math.max(0, tile.h - GAP);
            const big = w >= 74 && h >= 46;
            const mid = !big && w >= 44 && h >= 20;
            const cv = tile.item.colorValue;
            const label = `${tile.item.label}: ${sizeLabel} ${compactInr(tile.item.size)}, ${colorLabel} ${cv === null ? t('status.unknown') : formatColor(cv)}. ${t('chart.openProduct', 'Open this product’s orders in the ledger')}`;
            const body = (
              <>
                <rect className={`tm-tile tm-step-${step < 0 ? `n${-step}` : step}`} x={tile.x + GAP / 2} y={tile.y + GAP / 2} width={w} height={h} rx={3} />
                {big || mid ? (
                  <text className={`tm-label${Math.abs(step) === 3 ? ' is-dark' : ''}`} x={tile.x + 8} y={tile.y + 18}>
                    <tspan className="tm-name">{fit(tile.item.label, w - 14)}</tspan>
                    {big ? (
                      <>
                        <tspan x={tile.x + 8} dy={16} className="tm-num">
                          {compactInr(tile.item.size)}
                        </tspan>
                        <tspan x={tile.x + 8} dy={15} className="tm-num">
                          {cv === null ? t('status.unknown') : `${formatColor(cv)} ${t('chart.perUnitShort', '/unit')}`}
                        </tspan>
                      </>
                    ) : null}
                  </text>
                ) : null}
              </>
            );
            const events = {
              onPointerEnter: () => setTip(tipFor(tile)),
              onPointerLeave: () => setTip(null),
              onFocus: () => setTip(tipFor(tile)),
              onBlur: () => setTip(null),
            };
            return tile.item.href ? (
              <a key={tile.item.key} href={tile.item.href} className="tm-link" aria-label={label} data-key={tile.item.key} data-area={Math.round(tile.w * tile.h)} {...events}>
                {body}
              </a>
            ) : (
              <g key={tile.item.key} className="tm-link" tabIndex={0} aria-label={label} data-key={tile.item.key} data-area={Math.round(tile.w * tile.h)} {...events}>
                {body}
              </g>
            );
          })}
        </svg>
        <ChartTip tip={tip} />
      </div>
      <div className="tm-legend" aria-label={t('chart.colourScale', 'Colour scale: {{measure}}', { measure: colorLabel })}>
        <span className="tm-legend-end">{maxAbs > 0 ? formatColor(-maxAbs) : formatColor(0)}</span>
        <span className="tm-legend-steps" aria-hidden="true">
          {['n3', 'n2', 'n1', '0', '1', '2', '3'].map((s) => (
            <span key={s} className={`tm-swatch tm-step-${s}`} />
          ))}
        </span>
        <span className="tm-legend-end">{maxAbs > 0 ? `+${formatColor(maxAbs)}` : formatColor(0)}</span>
        <span className="tm-legend-caption">{t('chart.treemapLegend', 'Area: {{size}} · colour: {{colour}}', { size: sizeLabel, colour: colorLabel })}</span>
      </div>
      {left > 0 ? <p className="field-hint">{t('chart.treemapLeftOut', '{{n}} products with no net sales are not drawn; they are in the table.', { n: left })}</p> : null}
    </div>
  );
}

/** Cut a label to fit a width (about 7px a character at 12px). */
function fit(s: string, px: number): string {
  const max = Math.max(2, Math.floor(px / 7));
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
