import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { ChatProvider } from './contexts/ChatContext';
import { registerSW } from 'virtual:pwa-register';
import { removeLegacyFirebaseMessagingWorkers } from './services/serviceWorkerCleanup';
import './index.css';

async function registerApplicationWorker() {
  await removeLegacyFirebaseMessagingWorkers().catch(() => {});
  registerSW({
    immediate: true,
    onRegisteredSW(_serviceWorkerUrl, registration) {
      if (!registration) return;
      const checkForUpdate = () => registration.update().catch(() => {});
      window.addEventListener('focus', checkForUpdate);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    },
  });
}

if (window.location.protocol !== 'file:') registerApplicationWorker();

const ApplicationRouter = window.location.protocol === 'file:' ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ApplicationRouter>
      <AuthProvider>
        <ChatProvider>
          <App />
        </ChatProvider>
      </AuthProvider>
    </ApplicationRouter>
  </React.StrictMode>
);
