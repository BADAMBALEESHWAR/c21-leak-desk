// "Ask about this": any screen opens Ask Profyn with a question through one window event; the drawer listens.
// Questions are plain words in the UI language and never carry a figure the screen did not show.
import type { TFunction } from 'i18next';

export const ASK_EVENT = 'profyn:ask';

export interface AskEventDetail {
  question: string;
  /** Send at once (default); false only fills the input. */
  send?: boolean;
}

/** Opens Ask Profyn with the question and, unless send is false, asks it. */
export function askProfyn(question: string, send = true): void {
  window.dispatchEvent(new CustomEvent<AskEventDetail>(ASK_EVENT, { detail: { question, send } }));
}

/** The question behind a leak card, by cause. */
export function leakQuestion(t: TFunction, cause: string, label: string): string {
  switch (cause) {
    case 'full_return_partial_recovery':
      return t('askq.fullReturn', 'Why are we losing money on full returns?');
    case 'discount_exceeds_margin':
      return t('askq.discount', 'How do I fix discounts deeper than margin?');
    case 'fees_exceed_margin':
      return t('askq.fees', 'Why do shipping and fees exceed margin?');
    case 'refund_unknown':
      return t('askq.refundUnknown', 'Why are some refunds unknown?');
    case 'other_negative':
      return t('askq.otherNegative', 'Why are returned orders losing money?');
    default:
      return t('askq.leak', 'Why are we losing money on “{{label}}”?', { label });
  }
}

/** The question behind an action card, by intervention. */
export function actionQuestion(t: TFunction, intervention: string, label: string): string {
  switch (intervention) {
    case 'raise_recovery_via_inspection':
      return t('askq.inspect', 'How does inspecting returns raise recovery?');
    case 'charge_return_shipping':
      return t('askq.returnShipping', 'What if we charge return shipping?');
    case 'cap_discount':
      return t('askq.capDiscount', 'What if we cap discounts?');
    case 'add_handling_to_price':
      return t('askq.handling', 'What if we add handling to the price?');
    default:
      return t('askq.action', 'Explain this action: {{label}}', { label });
  }
}
