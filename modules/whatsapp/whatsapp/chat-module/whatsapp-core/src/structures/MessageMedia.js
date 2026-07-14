'use strict';

const fs = require('fs');
const path = require('path');
const mime = require('mime');
const fetch = require('node-fetch');
const { URL } = require('url');

/**
 * Media attached to a message
 * @param {string} mimetype MIME type of the attachment
 * @param {string} data Base64-encoded data of the file
 * @param {?string} filename Document file name. Value can be null
 * @param {?number} filesize Document file size in bytes. Value can be null
 */
class MessageMedia {
    constructor(mimetype, data, filename, filesize) {
        /**
         * MIME type of the attachment
         * @type {string}
         */
        this.mimetype = mimetype;

        /**
         * Base64 encoded data that represents the file
         * @type {string}
         */
        this.data = data;

        /**
         * Document file name. Value can be null
         * @type {?string}
         */
        this.filename = filename;

        /**
         * Document file size in bytes. Value can be null
         * @type {?number}
         */
        this.filesize = filesize;
    }

    /**
     * Creates a MessageMedia instance from a local file path
     * @param {string} filePath
     * @returns {MessageMedia}
     */
    static fromFilePath(filePath) {
        const b64data = fs.readFileSync(filePath, { encoding: 'base64' });
        const mimetype = mime.getType(filePath);
        const filename = path.basename(filePath);

        return new MessageMedia(mimetype, b64data, filename);
    }

    /**
     * Creates a MessageMedia instance from a URL
     * @param {string} url
     * @param {Object} [options]
     * @param {boolean} [options.unsafeMime=false]
     * @param {string} [options.filename]
     * @param {object} [options.client]
     * @param {object} [options.reqOptions]
     * @param {number} [options.reqOptions.size=0]
     * @returns {Promise<MessageMedia>}
     */
    static async fromUrl(url, options = {}) {
        console.log('🔍 MessageMedia.fromUrl - Iniciando download:', url);

        const pUrl = new URL(url);
        let mimetype = mime.getType(pUrl.pathname);
        console.log('📄 MIME type detectado pelo path:', mimetype);

        if (!mimetype && !options.unsafeMime)
            throw new Error('Unable to determine MIME type using URL. Set unsafeMime to true to download it anyway.');

        async function fetchData(url, options) {
            console.log('📡 Fazendo fetch para:', url);
            console.log('⚙️ Opções de request:', options);

            const reqOptions = Object.assign({ headers: { accept: 'image/* video/* text/* audio/*' } }, options);
            console.log('📋 Headers finais:', reqOptions.headers);

            const response = await fetch(url, reqOptions);
            console.log('📥 Response status:', response.status, response.statusText);

            const mime = response.headers.get('Content-Type');
            const size = response.headers.get('Content-Length');
            console.log('📄 Content-Type do response:', mime);
            console.log('📏 Content-Length:', size);

            const contentDisposition = response.headers.get('Content-Disposition');
            const name = contentDisposition ? contentDisposition.match(/((?<=filename=")(.*)(?="))/) : null;

            let data = '';
            if (response.buffer) {
                console.log('📦 Usando response.buffer()');
                data = (await response.buffer()).toString('base64');
            } else {
                console.log('📦 Usando response.arrayBuffer()');
                const bArray = new Uint8Array(await response.arrayBuffer());
                bArray.forEach((b) => {
                    data += String.fromCharCode(b);
                });
                data = btoa(data);
            }

            console.log('✅ Dados convertidos para base64, tamanho:', data.length);
            return { data, mime, name, size };
        }

        const res = options.client
            ? (await options.client.pupPage.evaluate(fetchData, url, options.reqOptions))
            : (await fetchData(url, options.reqOptions));

        console.log('📋 Resultado do fetch:', {
            hasData: !!res.data,
            dataLength: res.data ? res.data.length : 0,
            mime: res.mime,
            name: res.name,
            size: res.size
        });

        const filename = options.filename ||
            (res.name ? res.name[0] : (pUrl.pathname.split('/').pop() || 'file'));

        if (!mimetype)
            mimetype = res.mime;

        console.log('🏗️ Criando MessageMedia:', {
            mimetype,
            filename,
            hasData: !!res.data,
            filesize: res.size
        });

        return new MessageMedia(mimetype, res.data, filename, res.size || null);
    }
}

module.exports = MessageMedia;
