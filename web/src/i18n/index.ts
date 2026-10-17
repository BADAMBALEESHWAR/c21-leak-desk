// UI language: English (default), Hindi, Telugu. Chosen in the sidebar, kept in localStorage 'lang'.
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import hi from './hi.json';
import te from './te.json';

export const LANGS = ['en', 'hi', 'te'] as const;
export type Lang = (typeof LANGS)[number];

const STORAGE_KEY = 'lang';

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

function storedLang(): Lang {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isLang(v) ? v : 'en';
  } catch {
    return 'en';
  }
}

function setHtmlLang(lng: string): void {
  if (typeof document !== 'undefined' && isLang(lng)) document.documentElement.lang = lng;
}

/** Intl locale for numbers: Latin digits and Indian grouping in all three. */
export function localeFor(lng: string | undefined): 'en-IN' | 'hi-IN' | 'te-IN' {
  return lng === 'hi' ? 'hi-IN' : lng === 'te' ? 'te-IN' : 'en-IN';
}

/** Lower-case a UI word for mid-sentence use ("unknown", "template"); a no-op in Hindi and Telugu. */
export function lower(s: string): string {
  return s.toLowerCase();
}

export const i18n = i18next.createInstance();
i18n.on('languageChanged', setHtmlLang);
i18n.use(initReactI18next);
void i18n.init({
  resources: { en: { translation: en }, hi: { translation: hi }, te: { translation: te } },
  lng: storedLang(),
  fallbackLng: 'en',
  supportedLngs: [...LANGS],
  interpolation: { escapeValue: false },
  initAsync: false,
  react: { useSuspense: false },
});
setHtmlLang(i18n.language);

/** Switch the UI language now and remember it for the next visit. */
export function setLanguage(lng: Lang): void {
  if (!isLang(lng)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
  setHtmlLang(lng);
  void i18n.changeLanguage(lng);
}

export default i18n;
