// Service worker minimal : rend l'app installable (PWA) pour activer le partage natif.
// Volontairement sans cache offline pour éviter de servir une version périmée de l'app.
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => { /* pass-through réseau */ });
