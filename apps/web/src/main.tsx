import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

// Look for a new version every minute, so fixes reach people quickly instead of waiting for a restart
registerSW({
  immediate: true,
  onRegisteredSW(_url: string, registration: ServiceWorkerRegistration | undefined) {
    if (registration) setInterval(() => void registration.update().catch(() => undefined), 60_000);
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
