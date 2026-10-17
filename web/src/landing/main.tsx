import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../i18n';
import { Landing } from './Landing';
import '../styles/tokens.css';
import './base.css';
import './landing.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');

createRoot(root).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
