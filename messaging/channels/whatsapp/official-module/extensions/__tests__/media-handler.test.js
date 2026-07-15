const assert = require('node:assert/strict');
const test = require('node:test');
const MediaHandler = require('../media-handler');

test('fails closed for every remote media URL scheme and host', async () => {
    const handler = new MediaHandler({});
    const methods = [
        () => handler.sendImage('5511999999999', 'http://127.0.0.1/latest/meta-data'),
        () => handler.sendVideo('5511999999999', 'https://[::1]/private.mp4'),
        () => handler.sendDocument('5511999999999', 'https://user:pass@attacker.invalid/file.pdf'),
        () => handler.sendAudio('5511999999999', 'https://169.254.169.254/credentials'),
        () => handler.sendSticker('5511999999999', 'https://public.example.invalid/redirect')
    ];

    for (const invoke of methods) {
        await assert.rejects(invoke, (error) => error.code === MediaHandler.REMOTE_MEDIA_DISABLED);
    }
});

test('preserves local location delivery without any network URL', async () => {
    class FakeLocation {
        constructor(latitude, longitude, description) {
            this.latitude = latitude;
            this.longitude = longitude;
            this.description = description;
        }
    }
    const handler = new MediaHandler({
        sendMessage: async (chatId, location) => ({ id: { _serialized: `${chatId}:${location.latitude}` } })
    }, { LocationClass: FakeLocation });

    const result = await handler.sendLocation('5511999999999', -23.5, -46.6, 'clinic');
    assert.deepEqual(result, {
        success: true,
        messageId: '5511999999999@c.us:-23.5',
        type: 'location'
    });
});
