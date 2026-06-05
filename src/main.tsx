import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from '@/components/ui/sonner';
import App from './App.tsx';
import './index.css';

const storedTheme = window.localStorage.getItem('theme');
if (storedTheme === 'dark') {
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster richColors position="top-right" />
  </StrictMode>
);
