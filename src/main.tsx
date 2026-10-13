import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { ConvexReactClient } from 'convex/react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { Analytics } from '@vercel/analytics/react';
import App, { AppBoundary, emptyProps } from './App';
import CommonUI from './ui/CommonUI';
import './ui/styles.css';

const Preview = React.lazy(() => import('./Preview'));
const url = import.meta.env.VITE_CONVEX_URL;
const isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
const client = url ? new ConvexReactClient(url) : null;
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppBoundary>
      {isPreview ? <Suspense fallback={null}><Preview /></Suspense> : client ? <ConvexAuthProvider client={client}><App /></ConvexAuthProvider> : <CommonUI {...emptyProps} screen="login" error="Common is waiting for its backend connection." />}
    </AppBoundary>
    <Analytics mode={import.meta.env.PROD ? 'production' : 'development'} />
  </React.StrictMode>,
);
