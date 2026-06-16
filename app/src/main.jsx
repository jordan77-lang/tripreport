import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { initTextScale } from './lib/textScale';
import { AuthProvider } from './context/AuthContext.jsx';
import App from './App.jsx';

initTextScale();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
