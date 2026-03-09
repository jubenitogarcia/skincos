import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { WaMessageMetaStore } from '../waMessageMetaStore.js'

async function withStore(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wa-meta-test-'))
  const file = path.join(dir, 'wa_message_meta.json')
  const store = new WaMessageMetaStore(file)
  await store.init()
  try {
    await fn(store, file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('toggle reaction add/remove and aggregate', async () => {
  await withStore(async (store) => {
    const key = { channel: 1, remoteJid: '5511999990000@s.whatsapp.net', messageId: 'mid-1' }
    let reactions = store.toggleReaction(key.channel, key.remoteJid, key.messageId, '👍', 'email:a@a.com')
    assert.deepEqual(reactions, [{ emoji: '👍', count: 1, reactedByMe: true }])

    reactions = store.toggleReaction(key.channel, key.remoteJid, key.messageId, '👍', 'email:b@a.com')
    assert.deepEqual(reactions, [{ emoji: '👍', count: 2, reactedByMe: true }])

    reactions = store.toggleReaction(key.channel, key.remoteJid, key.messageId, '👍', 'email:a@a.com')
    assert.deepEqual(reactions, [{ emoji: '👍', count: 1, reactedByMe: false }])
  })
})

test('persist and reload keeps metadata', async () => {
  await withStore(async (store, file) => {
    store.setReply(1, '5511999990000@s.whatsapp.net', 'mid-2', {
      messageId: 'parent-1',
      textPreview: 'Mensagem original',
      direction: 'inbound'
    })
    store.toggleReaction(1, '5511999990000@s.whatsapp.net', 'mid-2', '❤️', 'email:a@a.com')
    await store.persist()

    const second = new WaMessageMetaStore(file)
    await second.init()
    const reactions = second.listReactions(1, '5511999990000@s.whatsapp.net', 'mid-2', 'email:a@a.com')
    assert.equal(reactions.length, 1)
    assert.equal(reactions[0].emoji, '❤️')
    const record = second.getRecord(1, '5511999990000@s.whatsapp.net', 'mid-2')
    assert.equal(record?.replyTo?.messageId, 'parent-1')
  })
})

test('decorateMessages merges media/reply/reactions', async () => {
  await withStore(async (store) => {
    store.setReply(1, '5511999990000@s.whatsapp.net', 'mid-3', {
      messageId: 'parent-2',
      textPreview: 'Texto pai',
      direction: 'outbound'
    })
    store.toggleReaction(1, '5511999990000@s.whatsapp.net', 'mid-3', '😂', 'email:a@a.com')
    const items = store.decorateMessages(
      1,
      '5511999990000@s.whatsapp.net',
      [
        {
          id: 'mid-3',
          mediaType: 'audio',
          mediaUrl: 'https://example.com/audio.ogg',
          mimeType: 'audio/ogg'
        }
      ],
      'email:a@a.com',
      ({ channel, remoteJid, messageId }) => `https://crm.local/api/wa-orchestrator/media?channel=${channel}&remoteJid=${encodeURIComponent(remoteJid)}&messageId=${messageId}`
    )
    assert.equal(items.length, 1)
    assert.equal(items[0].replyTo?.messageId, 'parent-2')
    assert.equal(items[0].reactions?.[0]?.emoji, '😂')
    assert.ok(items[0].mediaProxyUrl?.includes('messageId=mid-3'))
    assert.equal(items[0].media?.type, 'audio')
  })
})

test('toggle flags persist and deleted messages are filtered from decoration', async () => {
  await withStore(async (store, file) => {
    const key = { channel: 1, remoteJid: '5511999990000@s.whatsapp.net', messageId: 'mid-4' }
    let flags = store.toggleFlag(key.channel, key.remoteJid, key.messageId, 'favorite')
    assert.equal(flags.favorite, true)
    flags = store.toggleFlag(key.channel, key.remoteJid, key.messageId, 'pinned')
    assert.equal(flags.pinned, true)
    flags = store.toggleFlag(key.channel, key.remoteJid, key.messageId, 'reported')
    assert.equal(flags.reported, true)
    store.markDeleted(key.channel, key.remoteJid, key.messageId, true)
    await store.persist()

    const second = new WaMessageMetaStore(file)
    await second.init()
    const persistedFlags = second.getFlags(key.channel, key.remoteJid, key.messageId)
    assert.equal(persistedFlags.favorite, true)
    assert.equal(persistedFlags.pinned, true)
    assert.equal(persistedFlags.reported, true)
    assert.equal(persistedFlags.deleted, true)

    const items = second.decorateMessages(
      key.channel,
      key.remoteJid,
      [{ id: key.messageId, text: 'Oculta', mediaType: 'text' }],
      'email:a@a.com'
    )
    assert.equal(items.length, 0)
  })
})
