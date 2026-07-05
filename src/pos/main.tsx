import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import PosApp from './PosApp';
import { queryClient } from '../lib/queryClient';
import '../index.css';
import './styles/print.css';

ReactDOM.createRoot(document.getElementById('pos-root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <PosApp />
    </QueryClientProvider>
  </React.StrictMode>,
);
