// KIDOGUARD SERVICE WORKER (OFFLINE SUPPORT & PWA CACHING)
const CACHE_NAME = 'kidoguard-cache-v52';
const ASSETS_TO_CACHE = [
  './',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Guardando activos en caché para PWA offline');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Eliminando caché antiguo:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network-first strategy for real-time APIs, cache-first for static assets
  if (event.request.url.includes('/api/')) {
    event.respondWith(fetch(event.request));
  } else {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        return cachedResponse || fetch(event.request);
      })
    );
  }
});

// ESCUCHAR NOTIFICACIONES PUSH DE FONDO (INCLUSO CON NAVEGADOR CERRADO)
self.addEventListener('push', (event) => {
  let title = 'Alerta Familiar KidApp';
  let body = 'Mensaje de seguridad recibido.';
  let icon = './icon.jpg';

  if (event.data) {
    try {
      const dataObj = event.data.json();
      title = dataObj.title || title;
      body = dataObj.body || body;
      icon = dataObj.icon || icon;
    } catch (e) {
      body = event.data.text() || body;
    }
  }

  let vibratePattern = [200, 100, 200, 100, 200];
  let requireInteraction = false;

  const titleUpper = title.toUpperCase();
  if (titleUpper.includes('S.O.S') || titleUpper.includes('🚨') || titleUpper.includes('ALERTA')) {
    vibratePattern = [500, 100, 500, 100, 500, 100, 500, 100, 500];
    requireInteraction = true;
  } else if (titleUpper.includes('LLAMADA') || titleUpper.includes('📞') || titleUpper.includes('SOLICITADA')) {
    vibratePattern = [1000, 500, 1000, 500, 1000, 500, 1000]; // Vibración larga simulando timbre
    requireInteraction = true; // Mantiene flotante hasta que interactúe
  }

  const options = {
    body: body,
    icon: icon,
    badge: icon,
    vibrate: vibratePattern,
    requireInteraction: requireInteraction,
    data: { url: './' }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ABRIR O ENFOCAR LA PWA AL HACER CLICK EN LA ALERTA
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Si ya hay una ventana abierta de la app, enfocarla
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      // Si no, abrir una ventana nueva
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
