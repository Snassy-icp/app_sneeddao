import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.scss';
import './styles/theme.css';
import { completePendingCacheClear } from './utils/cacheUtils';

// Complete any pending cache clear BEFORE mounting React.
// This runs before any hooks open IndexedDB connections, so
// deleteDatabase() calls succeed immediately without blocking.
completePendingCacheClear().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
