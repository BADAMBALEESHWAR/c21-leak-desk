import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../i18n';
import { Login } from './Login';
import '../styles/tokens.css';
import '../landing/base.css';
import './login.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');

createRoot(root).render(
  <StrictMode>
    <Login />
  </StrictMode>,
);
