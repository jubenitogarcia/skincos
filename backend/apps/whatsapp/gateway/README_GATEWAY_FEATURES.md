# WhatsApp Gateway - Feature Endpoints

This document lists optional endpoints recommended for richer CRM integration. If your gateway doesn't expose them yet, implement these for best results.

## Sessions
- GET /status → { state: 'CONNECTED'|'QR'|'ERROR'|..., message?, qr? }
- POST /start → start/ensure session

## Chats
- GET /chats → list chats with optional flags
  - Suggested fields per chat: { id, name/pushName, messagesCount, archived (bool), pinned (bool), unreadCount (number) }
- GET /chats/flags → hydrate flags
  - Response: { pinned: string[], archived: string[], unread: string[] }

## Avatars
- GET /v1/contacts/:id/avatar → image or JSON { url | avatar | base64 }
- GET /contacts/:id/avatar → same as above
- GET /avatar?chatId=:id or /avatar?phone=:phone → fallback

## Media
- GET /v1/chats/:id/media?limit=20 → { media: [...] } or [...]
- Alternative fallbacks considered by the adapter:
  - /v1/media?chatId=:id&limit=20
  - /media?chatId=:id&limit=20
  - /chats/:id/media?limit=20
  - /chats/:id/messages?media=true&limit=20
  - /v1/messages/search?chatId=:id&hasMedia=1&limit=20

Media item suggested fields:
- { id, type (image|video|document|audio), timestamp, url, thumbnail?, caption?, mimetype? }

## Chat actions
- POST /chats/:id/archive
- DELETE /chats/:id/archive
- POST /chats/:id/pin
- DELETE /chats/:id/pin
- POST /chats/:id/read (mark seen)
- POST /chats/:id/mute?ms=28800000 (durations)
- DELETE /chats/:id/mute

All endpoints are localhost-only in this project.
