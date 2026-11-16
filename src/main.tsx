import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Subscribe from './Subscribe'
import './styles.css'
// Remove legacy offline caches: allocations must always be confirmed by the server.
if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))
if ('caches' in window) caches.keys().then(keys => keys.filter(k => k.startsWith('prime')).forEach(k => caches.delete(k)))
createRoot(document.getElementById('root')!).render(<StrictMode>{location.pathname.replace(/\/$/,'') === '/souscription' ? <Subscribe/> : <App/>}</StrictMode>)
