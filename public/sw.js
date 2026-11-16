// Retire legacy offline service workers on existing installations.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.registration.unregister().then(() => self.clients.claim())))
