import React from 'react';
import { createRoot } from 'react-dom/client';
import OrganizerPage from './pages/OrganizerPage';
import './styles/organizer.css';
import './styles/theme.css';
import './styles/organizer-react.css';

createRoot(document.getElementById('root')).render(<OrganizerPage />);
