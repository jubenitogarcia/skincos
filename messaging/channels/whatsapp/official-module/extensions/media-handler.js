const REMOTE_MEDIA_DISABLED = 'REMOTE_MEDIA_FETCH_DISABLED';

/**
 * The historical official module accepted arbitrary URLs and downloaded them
 * from the API process. That made this message API an SSRF primitive. Remote
 * media stays fail-closed until a dedicated broker exposes opaque media IDs
 * through a fixed, authenticated service boundary.
 */
class MediaHandler {
    constructor(client, { LocationClass } = {}) {
        this.client = client;
        this.LocationClass = LocationClass;
    }

    remoteMediaDisabled() {
        const error = new Error(
            'Remote media URLs are disabled. Use the approved media broker and an opaque media identifier.'
        );
        error.code = REMOTE_MEDIA_DISABLED;
        throw error;
    }

    async sendImage() { return this.remoteMediaDisabled(); }
    async sendVideo() { return this.remoteMediaDisabled(); }
    async sendDocument() { return this.remoteMediaDisabled(); }
    async sendAudio() { return this.remoteMediaDisabled(); }
    async sendSticker() { return this.remoteMediaDisabled(); }

    async sendLocation(number, latitude, longitude, description = '') {
        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
        const Location = this.LocationClass || require('../../official').Location;
        const result = await this.client.sendMessage(chatId, new Location(latitude, longitude, description));
        return { success: true, messageId: result.id._serialized, type: 'location' };
    }
}

module.exports = MediaHandler;
module.exports.REMOTE_MEDIA_DISABLED = REMOTE_MEDIA_DISABLED;
