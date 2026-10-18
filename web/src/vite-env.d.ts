/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Payment link for the optional paid sample audit; the button is hidden when empty. */
  readonly VITE_RAZORPAY_LINK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
