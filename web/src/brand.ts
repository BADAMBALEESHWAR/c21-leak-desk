// The product brand in one place. Change the name here and every screen follows.
export const BRAND = {
  name: 'Profyn',
  tagline: 'Know More. Earn Better.',
  domain: 'profyn.in',
  description:
    'Profyn shows a D2C brand the real contribution of every order — after refunds, recovery, shipping, fees and ads — finds where money leaks, and turns one fix into a measurable decision.',
  repoUrl: 'https://github.com/BADAMBALEESHWAR/c21-leak-desk',
  docsUrl: 'https://github.com/BADAMBALEESHWAR/c21-leak-desk/tree/main/docs',
} as const;

export const APP_PATH = '/app/';
/** "Try the demo": straight to the owner dashboard on the 12-month demo brand, in demo mode (nothing tied to an account). */
export const DEMO_URL = `${APP_PATH}?mode=demo#/pulse?load=demo_12m`;
