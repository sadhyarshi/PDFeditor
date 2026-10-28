import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { injectFonts } from './lib/fontsCss.js';
import './styles.css';

injectFonts();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
