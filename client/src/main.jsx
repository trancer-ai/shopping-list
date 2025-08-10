import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// replay queued writes on load and when back online
import { replayQueue } from './api'
replayQueue();
window.addEventListener('online', () => replayQueue());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// register service worker (served as /sw.js from public/)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}