import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/index.css';
import { registerServiceWorker } from './pwa/serviceWorker';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support and updates only for the deployed production build (never in dev/test builds).
if (import.meta.env.PROD && import.meta.env.VITE_FIREBASE_ENV === 'production') registerServiceWorker();
