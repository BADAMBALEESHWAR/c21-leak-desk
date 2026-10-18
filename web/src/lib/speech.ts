// Voice in Ask Profyn: the browser's own speech recognition (Web Speech API) for questions and speech synthesis for
// answers. Nothing is installed; where the browser has neither, the buttons are not shown.
import { useEffect, useState } from 'react';
import { localeFor } from '../i18n';

export interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
}

export interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: RecognitionResult };
}

/** The part of SpeechRecognition used here (not in TypeScript's DOM library). */
export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type RecognitionCtor = new () => Recognition;

/** SpeechRecognition (or Chrome's and Edge's webkit-prefixed one); null when the browser has none. */
export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** en-IN, hi-IN or te-IN for the UI language. */
export const speechLang = (lng: string | undefined) => localeFor(lng);

/** Everything heard so far, and whether the browser has finished with it. */
export function transcriptOf(e: RecognitionEvent): { text: string; final: boolean } {
  let text = '';
  let final = e.results.length > 0;
  for (let i = 0; i < e.results.length; i++) {
    const r = e.results[i];
    text += r[0]?.transcript ?? '';
    if (!r.isFinal) final = false;
  }
  return { text: text.replace(/\s+/g, ' ').trim(), final };
}

/** speechSynthesis, or null when the browser cannot speak. */
export function synthesis(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return null;
  return window.speechSynthesis;
}

const norm = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-').toLowerCase();

/** A voice for the language: the Indian one first (en-IN), then any of the same language; null when there is none. */
export function voiceFor(lng: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const want = speechLang(lng).toLowerCase();
  const base = want.split('-')[0];
  return voices.find((v) => norm(v) === want) ?? voices.find((v) => norm(v).split('-')[0] === base) ?? null;
}

/** The installed voices; browsers load them late, so this follows voiceschanged. */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => synthesis()?.getVoices?.() ?? []);
  useEffect(() => {
    const s = synthesis();
    if (!s || typeof s.addEventListener !== 'function') return undefined;
    const update = () => setVoices(s.getVoices?.() ?? []);
    update();
    s.addEventListener('voiceschanged', update);
    return () => s.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}
