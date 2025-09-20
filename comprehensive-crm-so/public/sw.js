// Service Worker for Push Notifications and PWA support
const CACHE_NAME = 'crm-inteligente-v2'
const urlsToCache = [
  '/',
  '/src/main.tsx',
  '/src/main.css',
  '/src/index.css'
]

// Rate limiting configuration
const rateLimitConfig = {
  maxRequests: 50,
  timeWindow: 60000, // 1 minute
  requests: new Map()
}

// Rate limiting function
function isRateLimited(url) {
  const now = Date.now()
  const requests = rateLimitConfig.requests.get(url) || []
  
  // Clean old requests
  const recentRequests = requests.filter(time => now - time < rateLimitConfig.timeWindow)
  
  if (recentRequests.length >= rateLimitConfig.maxRequests) {
    return true
  }
  
  recentRequests.push(now)
  rateLimitConfig.requests.set(url, recentRequests)
  return false
}

// Install event - cache resources
self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  )
})

// Fetch event - serve from cache when offline with rate limiting
self.addEventListener('fetch', (event) => {
  // Skip rate limiting for same-origin requests
  if (event.request.url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          if (response) {
            return response
          }
          
          // Rate limit external requests
          if (isRateLimited(event.request.url)) {
            return new Response('Rate limited', { status: 429 })
          }
          
          return fetch(event.request).catch(() => {
            // Return offline page if available
            return caches.match('/offline.html') || new Response('Offline')
          })
        })
    )
  }
})

// Push notification event
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'Nova notificação do CRM',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'Ver detalhes',
        icon: '/icon-192x192.png'
      },
      {
        action: 'close',
        title: 'Fechar',
        icon: '/icon-192x192.png'
      }
    ]
  }

  event.waitUntil(
    self.registration.showNotification('CRM Inteligente', options)
  )
})

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'explore') {
    event.waitUntil(clients.openWindow('/'))
  } else if (event.action === 'close') {
    return
  } else {
    event.waitUntil(clients.openWindow('/'))
  }

  // Send message to main thread
  event.waitUntil(
    clients.matchAll().then((clientList) => {
      if (clientList.length > 0) {
        clientList[0].postMessage({
          type: 'NOTIFICATION_CLICKED',
          action: event.action,
          url: event.action === 'explore' ? '/notifications' : '/'
        })
      }
    })
  )
})

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync())
  }
})

function doBackgroundSync() {
  return Promise.resolve()
}

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      clients.claim(),
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName)
            }
          })
        )
      })
    ])
  )
})