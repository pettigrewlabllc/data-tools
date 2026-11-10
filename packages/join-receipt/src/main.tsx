import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './looks.css';

// Look picker (temporary, see looks.css): ?look=till | ledger | lab. ?sample=1 loads the sample data.
const look = new URLSearchParams(location.search).get('look');
if (look) document.documentElement.dataset.look = look;

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
