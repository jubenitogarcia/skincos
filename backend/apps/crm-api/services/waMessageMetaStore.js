import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SKINCOS_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const BACKEND_ROOT = path.join(SKINCOS_ROOT, 'backend')
const VAR_DIR = process.env.VAR_DIR || path.join(BACKEND_ROOT, 'var')
const DEFAULT_FILE = process.env.WA_MESSAGE_META_FILE || path.join(VAR_DIR, 'core', 'wa_message_meta.json')

const EMOJI_PATTERN = /[\p{Extended_Pictographic}\u200d\ufe0f]/u
const MESSAGE_FLAGS = new Set(['favorite', 'pinned', 'reported'])

function normalizeRemoteJid(remoteJid) {
  const value = String(remoteJid || '').trim()
  if (!value) return ''
  if (value.includes('@')) return value
  return `${value}@s.whatsapp.net`
}

function normalizeText(value, max = 240) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function normalizeEmoji(value) {
  const emoji = String(value || '').trim()
  if (!emoji || emoji.length > 16 || !EMOJI_PATTERN.test(emoji)) return ''
  return emoji
}

function buildKey(channel, remoteJid, messageId) {
  return `${Number(channel) || 0}|${normalizeRemoteJid(remoteJid)}|${String(messageId || '').trim()}`
}

export class WaMessageMetaStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath
    this.loaded = false
    this.saveTimer = null
    this.state = { items: {} }
  }

  async init() {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const json = JSON.parse(raw)
      if (json && typeof json === 'object' && json.items && typeof json.items === 'object') {
        this.state = { items: json.items }
      }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true })
        await this.persist()
        return
      }
      this.state = { items: {} }
    }
  }

  async persist() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2))
  }

  schedulePersist() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.persist().catch(() => { /* ignore */ })
    }, 250)
    this.saveTimer.unref?.()
  }

  getOrCreateRecord(channel, remoteJid, messageId) {
    const key = buildKey(channel, remoteJid, messageId)
    if (!key.endsWith('|')) {
      if (!this.state.items[key]) this.state.items[key] = { updatedAt: new Date().toISOString() }
      return { key, record: this.state.items[key] }
    }
    return { key: '', record: null }
  }

  getRecord(channel, remoteJid, messageId) {
    const key = buildKey(channel, remoteJid, messageId)
    return key ? this.state.items[key] || null : null
  }

  setReply(channel, remoteJid, messageId, replyTo) {
    const { key, record } = this.getOrCreateRecord(channel, remoteJid, messageId)
    if (!key || !record) return null
    const replyMessageId = String(replyTo?.messageId || '').trim()
    const textPreview = normalizeText(replyTo?.textPreview || '')
    if (!replyMessageId || !textPreview) return null
    record.replyTo = {
      messageId: replyMessageId,
      textPreview,
      direction: replyTo?.direction === 'outbound' ? 'outbound' : 'inbound'
    }
    record.updatedAt = new Date().toISOString()
    this.schedulePersist()
    return record.replyTo
  }

  setMedia(channel, remoteJid, messageId, media) {
    const { key, record } = this.getOrCreateRecord(channel, remoteJid, messageId)
    if (!key || !record) return null
    const type = String(media?.type || media?.mediaType || 'unknown').toLowerCase()
    const url = String(media?.url || media?.mediaUrl || '').trim()
    if (!url) return null
    record.media = {
      type: type || 'unknown',
      url,
      mimeType: media?.mimeType || null,
      fileName: media?.fileName || null,
      durationSec: Number.isFinite(Number(media?.durationSec)) ? Number(media.durationSec) : undefined,
      sizeBytes: Number.isFinite(Number(media?.sizeBytes)) ? Number(media.sizeBytes) : undefined
    }
    record.updatedAt = new Date().toISOString()
    this.schedulePersist()
    return record.media
  }

  listReactions(channel, remoteJid, messageId, actor) {
    const record = this.getRecord(channel, remoteJid, messageId)
    const reactions = record?.reactions && typeof record.reactions === 'object' ? record.reactions : {}
    return Object.entries(reactions)
      .map(([emoji, users]) => ({
        emoji,
        count: Array.isArray(users) ? users.length : 0,
        reactedByMe: Array.isArray(users) ? users.includes(actor) : false
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
  }

  toggleReaction(channel, remoteJid, messageId, emojiRaw, actor) {
    const emoji = normalizeEmoji(emojiRaw)
    if (!emoji) throw new Error('EMOJI_INVALID')
    const actorKey = String(actor || '').trim()
    if (!actorKey) throw new Error('ACTOR_REQUIRED')

    const { key, record } = this.getOrCreateRecord(channel, remoteJid, messageId)
    if (!key || !record) throw new Error('MESSAGE_ID_REQUIRED')
    if (!record.reactions || typeof record.reactions !== 'object') record.reactions = {}
    const current = Array.isArray(record.reactions[emoji]) ? [...record.reactions[emoji]] : []
    const idx = current.indexOf(actorKey)
    if (idx >= 0) {
      current.splice(idx, 1)
    } else {
      current.push(actorKey)
    }
    if (current.length) {
      record.reactions[emoji] = current
    } else {
      delete record.reactions[emoji]
    }
    record.updatedAt = new Date().toISOString()
    this.schedulePersist()
    return this.listReactions(channel, remoteJid, messageId, actorKey)
  }

  getFlags(channel, remoteJid, messageId) {
    const record = this.getRecord(channel, remoteJid, messageId)
    return {
      favorite: Boolean(record?.favorite),
      pinned: Boolean(record?.pinned),
      reported: Boolean(record?.reported),
      deleted: Boolean(record?.deleted)
    }
  }

  toggleFlag(channel, remoteJid, messageId, fieldRaw) {
    const field = String(fieldRaw || '').trim().toLowerCase()
    if (!MESSAGE_FLAGS.has(field)) throw new Error('FLAG_INVALID')
    const { key, record } = this.getOrCreateRecord(channel, remoteJid, messageId)
    if (!key || !record) throw new Error('MESSAGE_ID_REQUIRED')
    record[field] = !Boolean(record[field])
    record.updatedAt = new Date().toISOString()
    this.schedulePersist()
    return this.getFlags(channel, remoteJid, messageId)
  }

  markDeleted(channel, remoteJid, messageId, deleted = true) {
    const { key, record } = this.getOrCreateRecord(channel, remoteJid, messageId)
    if (!key || !record) throw new Error('MESSAGE_ID_REQUIRED')
    record.deleted = Boolean(deleted)
    record.updatedAt = new Date().toISOString()
    this.schedulePersist()
    return this.getFlags(channel, remoteJid, messageId)
  }

  decorateMessages(channel, remoteJid, items, actor, buildMediaProxyUrl) {
    if (!Array.isArray(items)) return []
    return items.map((item) => {
      const messageId = String(item?.id || '').trim()
      if (!messageId) return item
      const record = this.getRecord(channel, remoteJid, messageId)
      if (record?.deleted) return null
      const runtimeMedia = item?.mediaUrl
        ? {
            type: String(item?.mediaType || item?.type || 'unknown').toLowerCase(),
            url: String(item.mediaUrl),
            mimeType: item?.mimeType || null,
            fileName: item?.fileName || null,
            durationSec: Number.isFinite(Number(item?.durationSec)) ? Number(item.durationSec) : undefined,
            sizeBytes: Number.isFinite(Number(item?.sizeBytes)) ? Number(item.sizeBytes) : undefined
          }
        : null
      if (!record?.media && runtimeMedia?.url) {
        this.setMedia(channel, remoteJid, messageId, runtimeMedia)
      }
      const media = record?.media || runtimeMedia || null
      const reactions = this.listReactions(channel, remoteJid, messageId, actor)
      const mediaProxyUrl = media?.url && typeof buildMediaProxyUrl === 'function'
        ? buildMediaProxyUrl({ channel, remoteJid, messageId })
        : undefined
      return {
        ...item,
        favorite: Boolean(record?.favorite),
        pinned: Boolean(record?.pinned),
        reported: Boolean(record?.reported),
        replyTo: record?.replyTo || undefined,
        reactions,
        media: media || undefined,
        mediaProxyUrl
      }
    }).filter(Boolean)
  }

  findMedia(channel, remoteJid, messageId) {
    const record = this.getRecord(channel, remoteJid, messageId)
    return record?.media || null
  }
}

export const waMessageMetaStore = new WaMessageMetaStore()
