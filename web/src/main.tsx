import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './state/store';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');

createRoot(root).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
