import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { i18n } from './i18n';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { BRAND } from './brand';
import { StoreProvider } from './state/store';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

// The tab title follows the chosen language.
const setTitle = () => {
  document.title = i18n.t('app.docTitle', '{{brand}} — app', { brand: BRAND.name });
};
setTitle();
i18n.on('languageChanged', setTitle);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </AuthProvider>
  </StrictMode>,
);
