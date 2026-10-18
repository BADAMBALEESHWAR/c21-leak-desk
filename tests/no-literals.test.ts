// Zero English literals in the UI (work order v2 §7): every user-visible word in web/src/**/*.tsx goes through t().
// Scans JSX text, string-valued visible props (title, aria-label, placeholder, alt, label, hint, ...) and string or
// template literals rendered as JSX children, and fails listing file:line for any Latin word (2+ letters) outside t().
// Intentional literals (brands, formats, units, code identifiers) live in tests/i18n-literal-allowlist.json.
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type * as TS from 'typescript';

const require = createRequire(import.meta.url);
const ts: typeof TS = require('../web/node_modules/typescript');
const SRC = fileURLToPath(new URL('../web/src/', import.meta.url));
const ALLOW = JSON.parse(readFileSync(fileURLToPath(new URL('./i18n-literal-allowlist.json', import.meta.url)), 'utf8')) as {
  terms: string[];
  texts: string[];
};

/** Props whose string value is shown or read aloud. */
const VISIBLE_PROPS = new Set([
  'title', 'aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'placeholder', 'alt', 'label', 'hint',
  'caption', 'subtitle', 'description', 'summary', 'note', 'heading', 'lead', 'sub', 'help', 'tooltip', 'text', 'message',
  'empty', 'legend', 'eyebrow', 'cta', 'detail', 'body', 'measure', 'unitLabel', 'confirm', 'question',
]);
const VISIBLE_SUFFIX = /(Label|Text|Title|Hint|Note|Caption|Description|Message|Placeholder|Heading|Subtitle|Summary|Tooltip|Body|Detail)$/;
const isVisibleProp = (name: string) => VISIBLE_PROPS.has(name) || VISIBLE_SUFFIX.test(name);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TERMS = new RegExp(`(?<![\\p{L}\\d_])(?:${[...ALLOW.terms].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![\\p{L}\\d_])`, 'gu');

/** True when the text still has an English word once placeholders, entities, code tokens and allowlisted terms are removed. */
export function hasEnglish(raw: string): boolean {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s || ALLOW.texts.includes(s)) return false;
  const rest = s
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/&[a-zA-Z]+;|&#\d+;/g, ' ')
    .split(/\s+/)
    .filter((tok) => !/^[^\s]*[A-Za-z][^\s]*[_./][^\s]*$|^[_./]/.test(tok.replace(/[(),:;!?'"“”‘’]+$/g, ''))) // refund_inr, docs/SCOPE.md, shpat_, .csv
    .join(' ')
    .replace(TERMS, ' ');
  return /[A-Za-z]{2,}/.test(rest);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.tsx$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

const COMPARISON = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword,
]);

/** English literals in one .tsx file, as "path:line text". */
export function literalsIn(file: string, text = readFileSync(file, 'utf8')): string[] {
  const rel = file.slice(SRC.length).replace(/\\/g, '/');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const report = (n: TS.Node, s: string) =>
    found.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${JSON.stringify(s.replace(/\s+/g, ' ').trim().slice(0, 90))}`);

  // String and template literals inside a rendered expression; calls (t(), formatters), functions and JSX are not entered.
  const expr = (n: TS.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (hasEnglish(n.text)) report(n, n.text);
      return;
    }
    if (ts.isTemplateExpression(n)) {
      const parts = [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' {{x}} ');
      if (hasEnglish(parts)) report(n, parts);
      n.templateSpans.forEach((s) => expr(s.expression));
      return;
    }
    if (ts.isCallExpression(n) || ts.isTaggedTemplateExpression(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) return;
    if (ts.isBinaryExpression(n) && COMPARISON.has(n.operatorToken.kind)) return;
    if (ts.isElementAccessExpression(n)) return expr(n.expression);
    if (ts.isAsExpression(n) || ts.isSatisfiesExpression(n)) return expr(n.expression);
    ts.forEachChild(n, expr);
  };

  const visit = (n: TS.Node): void => {
    if (ts.isJsxText(n)) {
      if (hasEnglish(n.text)) report(n, n.text);
      return;
    }
    if (ts.isJsxAttribute(n)) {
      const name = n.name.getText(sf);
      const init = n.initializer;
      if (init && isVisibleProp(name)) {
        if (ts.isStringLiteral(init)) {
          if (hasEnglish(init.text)) report(init, init.text);
        } else if (ts.isJsxExpression(init) && init.expression) expr(init.expression);
      }
    } else if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
      expr(n.expression);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe('no English literals in the UI', () => {
  it('the detector flags English and accepts allowlisted text', () => {
    expect(hasEnglish('Allocate ads')).toBe(true);
    expect(hasEnglish('files at once')).toBe(true);
    expect(hasEnglish('Profyn · CSV / JSON')).toBe(false);
    expect(hasEnglish('{{n}} · ₹')).toBe(false);
    expect(hasEnglish('refund_inr')).toBe(false);
    expect(hasEnglish('docs/SCOPE.md')).toBe(false);
    expect(hasEnglish('Meta Ads')).toBe(false);
    expect(hasEnglish('&rsquo;')).toBe(false);
    const sample = `export const A = () => <p title="Open it" aria-label={x ? 'Show' : t('k', 'Hide')}>Hello {'world'} {t('a', 'ok')} {mode === 'channel' ? <b>Profyn</b> : null}</p>;`;
    expect(literalsIn(join(SRC, 'sample.tsx'), sample).map((s) => s.split(' ').slice(1).join(' '))).toEqual(['"Open it"', '"Show"', '"Hello"', '"world"']);
  });

  it('every user-visible word in web/src/**/*.tsx goes through t()', () => {
    const found = sourceFiles(SRC).flatMap((f) => literalsIn(f));
    expect(found).toEqual([]);
  });
});
