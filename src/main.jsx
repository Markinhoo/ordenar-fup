import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme.css';

const ControlPage = lazy(() => import('./pages/ControlPage'));
const OrganizerPage = lazy(() => import('./pages/OrganizerPage'));
const ActivatePage = lazy(() => import('./pages/ActivatePage'));
const LegacyRoomPage = lazy(() => import('./pages/LegacyRoomPage'));

const path = location.pathname.toLowerCase();
const legacy = new URLSearchParams(location.search).has('s');
const oldRoom = path.endsWith('/sala') || path.endsWith('/legacy/organizar.html')
  || legacy && (path.endsWith('/organizar') || path.endsWith('/organizar.html') || path === '/');
const Page = path.endsWith('/activar') || path.endsWith('/activar.html') ? ActivatePage
  : oldRoom ? LegacyRoomPage
    : path.endsWith('/organizar') || path.endsWith('/organizar.html') ? OrganizerPage : ControlPage;

createRoot(document.getElementById('root')).render(<Suspense fallback={<div role="status" className="app-loading">Abriendo Ordenar FUP…</div>}><Page /></Suspense>);
