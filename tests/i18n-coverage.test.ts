// Every UI string has an English, Hindi and Telugu entry: scans web/src for t('key') calls and checks the three language files.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../web/src/i18n/en.json';
import hi from '../web/src/i18n/hi.json';
import te from '../web/src/i18n/te.json';

type Dict = { [k: string]: string | Dict };
const SRC = fileURLToPath(new URL('../web/src/', import.meta.url));

function flatten(o: Dict, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

const FLAT = { en: flatten(en as Dict), hi: flatten(hi as Dict), te: flatten(te as Dict) };
const NAMESPACES = new Set(Object.keys(en));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

/** Keys used by the UI: literal t()/i18n.t() calls, <Trans i18nKey>, key constants and key-valued object fields. */
function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  const add = (k: string, file: string) => {
    if (!keys.has(k)) keys.set(k, file.slice(SRC.length).replace(/\\/g, '/'));
  };
  for (const file of sourceFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    // t('a.b', ...), i18n.t("a.b"), t(`a.b`) without interpolation.
    for (const m of src.matchAll(/(?<![\w$])(?:i18n\.)?t\(\s*(['"`])([^'"`$\s]+)\1/g)) add(m[2], file);
    for (const m of src.matchAll(/i18nKey=\{?\s*(['"])([^'"]+)\1/g)) add(m[2], file);
    // Keys kept in constants or tables and translated at the call site: FOO_KEY = 'a.b', { nameKey: 'a.b' }, { key|title|label: 'a.b' }.
    for (const m of src.matchAll(/\b[A-Z][A-Z0-9_]*_KEY\s*=\s*'([^']+)'/g)) if (!/^(profyn.|lang$)/.test(m[1])) add(m[1], file); // storage keys are not text
    for (const m of src.matchAll(/\b(?:\w+Key|key|title|label)\s*:\s*'([a-zA-Z]\w*(?:\.\w+)+)'/g)) {
      if (NAMESPACES.has(m[1].split('.')[0])) add(m[1], file);
    }
  }
  // Keys built from a route or language code at runtime.
  for (const r of ['import', 'ledger', 'leaks', 'scenario', 'decision', 'pulse', 'checks', 'changelog', 'report']) add(`nav.${r}`, SRC + 'components/Sidebar.tsx');
  for (const r of ['import', 'ledger', 'leaks', 'scenario', 'decision', 'pulse']) add(`nav.hint.${r}`, SRC + 'components/Sidebar.tsx');
  for (const l of ['en', 'hi', 'te']) add(`lang.${l}`, SRC + 'components/Sidebar.tsx');
  return keys;
}

/** A key with a count resolves to its plural forms (key_one, key_other). */
const has = (dict: Record<string, string>, k: string) => k in dict || `${k}_other` in dict;

const placeholders = (s: string) => [...s.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]).sort();

/** Terms kept in Latin script in every language, plus numbers, placeholders and punctuation. */
const ALLOWLIST = ['Profyn', 'AI', 'CSV', 'JSON', 'CM1', 'CM2', 'CM3', '₹', 'COD', 'UPI', 'Shopify', 'Meta Ads', 'Google Ads', 'Shiprocket', 'Razorpay', 'Amazon', 'Flipkart', 'Myntra'];
/** Language names are written in their own script on purpose (the switcher shows "English", "हिन्दी", "తెలుగు" in every language). */
const ENDONYM_KEYS = new Set(['lang.en', 'lang.hi', 'lang.te']);

function onlyAllowlisted(s: string): boolean {
  let rest = s.replace(/\{\{[^}]*\}\}/g, ' ');
  for (const term of ALLOWLIST) rest = rest.split(term).join(' ');
  return /^[\s\d\p{P}\p{S}]*$/u.test(rest);
}

describe('i18n coverage', () => {
  const used = usedKeys();

  it('finds the UI keys', () => {
    expect(used.size).toBeGreaterThan(400);
  });

  it.each(['en', 'hi', 'te'] as const)('every key used in web/src exists in %s.json', (lng) => {
    const missing = [...used].filter(([k]) => !has(FLAT[lng], k)).map(([k, f]) => `${k} (${f})`);
    expect(missing).toEqual([]);
  });

  it.each(['hi', 'te'] as const)('%s.json has exactly the keys en.json has', (lng) => {
    expect(Object.keys(FLAT.en).filter((k) => !(k in FLAT[lng]))).toEqual([]);
    expect(Object.keys(FLAT[lng]).filter((k) => !(k in FLAT.en))).toEqual([]);
  });

  it.each(['hi', 'te'] as const)('%s.json keeps every {{placeholder}}', (lng) => {
    const wrong = Object.keys(FLAT.en)
      .filter((k) => k in FLAT[lng])
      .filter((k) => placeholders(FLAT.en[k]).join() !== placeholders(FLAT[lng][k]).join())
      .map((k) => `${k}: ${placeholders(FLAT.en[k]).join()} vs ${placeholders(FLAT[lng][k]).join()}`);
    expect(wrong).toEqual([]);
  });

  it.each(['hi', 'te'] as const)('%s.json translates every string (only allowlisted terms may stay English)', (lng) => {
    const same = Object.keys(FLAT.en).filter(
      (k) => !ENDONYM_KEYS.has(k) && FLAT[lng][k] === FLAT.en[k] && !onlyAllowlisted(FLAT.en[k]),
    );
    expect(same).toEqual([]);
  });

  it('allowlists brand and format names only', () => {
    expect(onlyAllowlisted('Profyn')).toBe(true);
    expect(onlyAllowlisted('{{n}} · CSV / JSON')).toBe(true);
    expect(onlyAllowlisted('Meta Ads')).toBe(true);
    expect(onlyAllowlisted('Net revenue')).toBe(false);
  });
});
