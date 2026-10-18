import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { check2Rows, fetchChecks, formatPct2, type ProofChecks } from '../api/proof';
import { Pill } from '../components/Badge';
import { ButtonLink } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { PageHeader } from '../components/Page';
import { Callout, Collapsible } from '../components/ui';
import { formatInr } from '../lib/format';
import { INTERVENTION_LABELS } from '../lib/labels';
import { hrefFor } from '../lib/router';
import '../styles/proof.css';

// The page renders docs/FEEDBACK.md and docs/SCOPE.md as they are, so the app and the docs never drift.
// A glob (not a plain import) keeps a build without ../docs working: the web Docker image is built from web/ alone.
const DOCS = import.meta.glob<string>('../../../docs/{FEEDBACK,SCOPE}.md', { query: '?raw', import: 'default', eager: true });
const docText = (name: string): string | null => Object.entries(DOCS).find(([path]) => path.endsWith(`/${name}`))?.[1] ?? null;

// ---- A tiny, safe Markdown reader: headings, paragraphs, lists, bold, code, links, tables ----
// It builds React elements (never HTML strings), and only follows links into the app (#/…) or to http(s).

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'p'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; head: string[]; rows: string[][]; align: Array<'left' | 'right' | 'center'> }
  | { type: 'code'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'hr' };

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

const isTableSep = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
const LIST_RE = /^\s*([-*+]|\d+[.)])\s+(.*)$/;

function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      blocks.push({ type: 'heading', level: h[1].length, text: h[2] });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      blocks.push({ type: 'hr' });
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flush();
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : 'left') as 'left' | 'right' | 'center');
      const rows: string[][] = [];
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(splitRow(lines[i]));
      i--;
      blocks.push({ type: 'table', head, rows, align });
      continue;
    }
    const li = LIST_RE.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[1]);
      const items: string[] = [li[2]];
      for (i++; i < lines.length; i++) {
        const next = LIST_RE.exec(lines[i]);
        if (next && /\d/.test(next[1]) === ordered) items.push(next[2]);
        else if (/^\s{2,}\S/.test(lines[i]) && !next) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
      }
      i--;
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const body: string[] = [];
      for (; i < lines.length && /^\s*>\s?/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ''));
      i--;
      blocks.push({ type: 'quote', text: body.join(' ') });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

const safeHref = (href: string): string | null => (/^#\/[\w\-/?=&.%]*$/.test(href) || /^https?:\/\/[^\s"'<>]+$/.test(href) ? href : null);

const INLINE_RE = /(`[^`]+`)|(\*\*(.+?)\*\*)|(\[([^\]]+)\]\(([^)\s]+)\))|((?<![\w*])_(?!\s)([^_]+?)_(?![\w]))/g;

function renderInline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{renderInline(m[3], k)}</strong>);
    else if (m[4]) {
      const href = safeHref(m[6]);
      out.push(
        href ? (
          <a key={k} href={href} {...(href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}>
            {renderInline(m[5], k)}
          </a>
        ) : (
          <Fragment key={k}>{renderInline(m[5], k)}</Fragment>
        ),
      );
    } else if (m[7]) out.push(<em key={k}>{renderInline(m[8], k)}</em>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Scope table: the status words become pills. */
function Cell({ text }: { text: string }) {
  const plain = text.replace(/\*\*/g, '').trim();
  if (/^now$/i.test(plain))
    return (
      <Pill tone="success" icon="check">
        {plain}
      </Pill>
    );
  if (/^planned$/i.test(plain)) return <Pill tone="primary">{plain}</Pill>;
  if (/^out of scope$/i.test(plain)) return <Pill tone="neutral">{plain}</Pill>;
  return <>{renderInline(text)}</>;
}

/** Headings shift down so a document's # sits under the page title. */
function Markdown({ blocks, shift = 1 }: { blocks: Block[]; shift?: number }) {
  return (
    <div className="md">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.type) {
          case 'heading': {
            const level = Math.min(6, b.level + shift);
            const Tag = `h${level}` as 'h2';
            return (
              <Tag key={k} className={`md-h md-h${level}`}>
                {renderInline(b.text, k)}
              </Tag>
            );
          }
          case 'p':
            return <p key={k}>{renderInline(b.text, k)}</p>;
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={k}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it, `${k}-${j}`)}</li>
                ))}
              </Tag>
            );
          }
          case 'table':
            return (
              <div key={k} className="md-table table-scroll">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      {b.head.map((h, j) => (
                        <th key={j} scope="col" className={b.align[j] === 'right' ? 'r' : undefined}>
                          {renderInline(h, `${k}-h${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {b.head.map((_, c) => (
                          <td key={c} className={`cell-wrap${b.align[c] === 'right' ? ' r' : ''}`}>
                            <Cell text={r[c] ?? ''} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'code':
            return (
              <pre key={k} className="md-code">
                <code>{b.text}</code>
              </pre>
            );
          case 'quote':
            return <blockquote key={k}>{renderInline(b.text, k)}</blockquote>;
          case 'hr':
            return <hr key={k} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

// ---- FEEDBACK.md: the change-log section and its three parts --------------------------------

interface Part {
  title: string;
  blocks: Block[];
}

function splitFeedback(blocks: Block[]): { intro: Block[]; parts: Part[]; rest: Block[] } {
  const start = blocks.findIndex((b) => b.type === 'heading' && b.level === 2 && /change log/i.test(b.text));
  if (start < 0) return { intro: [], parts: [], rest: blocks };
  let end = blocks.findIndex((b, i) => i > start && b.type === 'heading' && b.level <= 2);
  if (end < 0) end = blocks.length;
  const section = blocks.slice(start + 1, end);
  const intro: Block[] = [];
  const parts: Part[] = [];
  for (const b of section) {
    if (b.type === 'heading' && b.level === 3) parts.push({ title: b.text.replace(/^\d+[.)]\s*/, ''), blocks: [] });
    else if (parts.length) parts[parts.length - 1].blocks.push(b);
    else intro.push(b);
  }
  return { intro, parts, rest: [...blocks.slice(0, start), ...blocks.slice(end)] };
}

/** "**Included**" followed by a list: shown as side-by-side groups. */
function PartBody({ blocks }: { blocks: Block[] }) {
  const out: ReactNode[] = [];
  let groups: Array<{ label: string; list: Block }> = [];
  const flushGroups = (k: string) => {
    if (!groups.length) return;
    out.push(
      <div key={k} className="cl-groups">
        {groups.map((g, i) => (
          <div key={i} className={`cl-group${/cut|out/i.test(g.label) ? ' is-cut' : ''}`}>
            <span className="cl-group-label">
              <Icon name={/cut|out/i.test(g.label) ? 'x' : 'check'} size={14} strokeWidth={2.5} />
              {g.label}
            </span>
            <Markdown blocks={[g.list]} />
          </div>
        ))}
      </div>,
    );
    groups = [];
  };
  let pending: Block[] = [];
  const flushPending = (k: string) => {
    if (pending.length) out.push(<Markdown key={k} blocks={pending} />);
    pending = [];
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const next = blocks[i + 1];
    const label = b.type === 'p' ? /^\*\*([^*]+)\*\*$/.exec(b.text.trim()) : null;
    if (label && next?.type === 'list') {
      flushPending(`p${i}`);
      groups.push({ label: label[1], list: next });
      i++;
      continue;
    }
    flushGroups(`g${i}`);
    pending.push(b);
  }
  flushGroups('g-end');
  flushPending('p-end');
  return <>{out}</>;
}

const PART_ICON: IconName[] = ['alert-triangle', 'sliders', 'check-circle'];
const PART_TONE = ['is-before', 'is-scope', 'is-evidence'];

// ---- Live evidence: the same run the Checks page shows ------------------------------------------

function LiveEvidence() {
  const { t } = useTranslation();
  const [data, setData] = useState<ProofChecks | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchChecks()
      .then((c) => !cancelled && setData(c))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <p className="proof-notyet">{t('changelog.liveFailed', 'The live checks could not be loaded just now.')}</p>;
  if (!data) return <p className="loading-line">{t('changelog.liveLoading', 'Loading the live checks…')}</p>;

  const c1 = data.check1;
  const c2 = data.check2;
  const c3 = data.check3;
  const c4 = data.check4;
  const rowsOk = (mode: 'allocate' | 'channel') => check2Rows(c2, mode)?.every((r) => r.difference === 0) ?? null;
  const name = (k: string | undefined) => (k ? INTERVENTION_LABELS[k] ?? k.replace(/_/g, ' ') : '—');
  const items: Array<{ n: number; label: string; value: ReactNode; pass: boolean | null }> = [
    { n: 1, label: t('changelog.ev1', 'Worked order'), value: c1 ? formatInr(c1.actual) : null, pass: c1?.pass ?? null },
    {
      n: 2,
      label: t('changelog.ev2', 'Extended sample, both modes'),
      value: c2 ? `${formatInr(c2.allocate_total)} = ${formatInr(c2.channel_total)}` : null,
      pass: c2 ? c2.pass && rowsOk('allocate') !== false && rowsOk('channel') !== false : null,
    },
    {
      n: 3,
      label: t('changelog.ev3', 'Missing refund: recommendation'),
      value: c3 ? (
        <>
          {name(c3.before?.intervention)} <Icon name="arrow-right" size={13} /> {name(c3.after_recovery_50?.intervention)}
        </>
      ) : null,
      pass: c3?.pass ?? null,
    },
    { n: 4, label: t('changelog.ev4', 'Contribution margin'), value: c4 ? formatPct2(c4.cm3_pct) : null, pass: c4?.pass ?? null },
  ];
  return (
    <div className="cl-live" aria-label={t('changelog.liveAria', 'Live check results')}>
      {items.map((it) => (
        <div key={it.n} className={`cl-live-item ${it.pass === null ? 'is-na' : it.pass ? 'is-pass' : 'is-fail'}`}>
          <span className="cl-live-head">
            {t('checks.checkN', 'Check {{n}}', { n: it.n })} · {it.label}
          </span>
          <strong className="cl-live-value num">{it.value ?? t('checks.notAvailable', 'Not available yet')}</strong>
          <span className="cl-live-pass">
            <Icon name={it.pass === null ? 'info' : it.pass ? 'check' : 'x'} size={13} strokeWidth={2.5} />
            {it.pass === null ? t('checks.notAvailable', 'Not available yet') : it.pass ? t('checks.pass', 'PASS') : t('checks.fail', 'FAIL')}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---- Screen -----------------------------------------------------------------------------

// The docs are fixed at build time: read them once.
const FEEDBACK_DOC = docText('FEEDBACK.md');
const SCOPE_DOC = docText('SCOPE.md');
const fb = FEEDBACK_DOC ? splitFeedback(parseMarkdown(FEEDBACK_DOC)) : null;
const scopeBlocks = SCOPE_DOC ? parseMarkdown(SCOPE_DOC) : null;
const scopeTitle = scopeBlocks?.find((b) => b.type === 'heading' && b.level === 1);
const scopeBody = scopeBlocks?.filter((b) => b !== scopeTitle) ?? [];

export function ChangelogScreen() {
  const { t } = useTranslation();

  return (
    <div className="page cl-page">
      <PageHeader
        title={t('changelog.title', 'Change log')}
        subtitle={t('changelog.subtitle', 'From the brief to the evidence: where the ledger started, the scope we agreed, and the proof it holds now.')}
        actions={
          <ButtonLink variant="primary" size="sm" href={hrefFor('checks')} iconRight="arrow-right">
            {t('changelog.openChecks', 'Open the checks')}
          </ButtonLink>
        }
      />

      {!fb || fb.parts.length === 0 ? (
        <Callout tone="info" title={t('changelog.noDocs', 'The change log text is not part of this build.')}>
          <p className="callout-hint">{t('changelog.noDocsHint', 'It is read from docs/FEEDBACK.md and docs/SCOPE.md in the repository; build the web app from the repository root to include them.')}</p>
        </Callout>
      ) : (
        <>
          <nav className="cl-steps" aria-label={t('changelog.stepsAria', 'The three parts')}>
            <ol>
              {fb.parts.map((p, i) => (
                <li key={p.title} className={PART_TONE[i] ?? ''}>
                  <span className="cl-step-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="cl-step-title">{p.title}</span>
                  {i < fb.parts.length - 1 ? (
                    <span className="cl-step-arrow" aria-hidden="true">
                      <Icon name="arrow-right" size={16} />
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </nav>

          {fb.intro.length ? (
            <div className="cl-intro">
              <Markdown blocks={fb.intro} />
            </div>
          ) : null}

          <ol className="cl-timeline">
            {fb.parts.map((p, i) => (
              <li key={p.title} className={`cl-part ${PART_TONE[i] ?? ''}`}>
                <span className="cl-part-marker" aria-hidden="true">
                  <Icon name={PART_ICON[i] ?? 'info'} size={18} />
                </span>
                <section className="card cl-card" aria-labelledby={`cl-part-${i}`}>
                  <header className="cl-card-head">
                    <span className="proof-kicker">{t('changelog.part', 'Part {{n}} of {{total}}', { n: i + 1, total: fb.parts.length })}</span>
                    <h2 id={`cl-part-${i}`} className="cl-card-title">
                      {p.title}
                    </h2>
                  </header>
                  <PartBody blocks={p.blocks} />
                  {i === fb.parts.length - 1 ? (
                    <div className="cl-live-wrap">
                      <h3 className="section-label">{t('changelog.liveTitle', 'Live now, from GET /api/v1/checks')}</h3>
                      <LiveEvidence />
                    </div>
                  ) : null}
                </section>
              </li>
            ))}
          </ol>
        </>
      )}

      {scopeBlocks ? (
        <section className="card cl-scope" aria-labelledby="cl-scope-title">
          <header className="cl-card-head">
            <span className="proof-kicker">docs/SCOPE.md</span>
            <h2 id="cl-scope-title" className="cl-card-title">
              {scopeTitle && scopeTitle.type === 'heading' ? renderInline(scopeTitle.text) : t('changelog.scopeTitle', 'Scope')}
            </h2>
          </header>
          <Markdown blocks={scopeBody} shift={1} />
        </section>
      ) : null}

      {fb && fb.rest.length ? (
        <Collapsible title={t('changelog.fullRecord', 'The full feedback record')} meta="docs/FEEDBACK.md">
          <div className="cl-record">
            <Markdown blocks={fb.rest} shift={1} />
          </div>
        </Collapsible>
      ) : null}
    </div>
  );
}
