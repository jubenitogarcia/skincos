const dns = require('dns').promises;
const https = require('https');
const net = require('net');

function isPrivateIpAddress(address) {
    if (net.isIP(address) === 4) {
        const [first, second] = address.split('.').map(Number);
        return first === 0 || first === 10 || first === 127 ||
            (first === 169 && second === 254) ||
            (first === 172 && second >= 16 && second <= 31) ||
            (first === 192 && second === 168) || first >= 224;
    }

    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' ||
        normalized.startsWith('fc') || normalized.startsWith('fd') ||
        normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
        normalized.startsWith('fea') || normalized.startsWith('feb');
}

function parsePublicHttpsUrl(value) {
    if (typeof value !== 'string') throw new Error('URL must be a string');

    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) {
        throw new Error('Only credential-free HTTPS URLs on the default port are allowed');
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (hostname.toLowerCase() === 'localhost' || net.isIP(hostname)) {
        // Accepting an IP literal makes it impossible to apply the DNS policy
        // consistently at connect time. Callers must use a public hostname.
        throw new Error('IP literals and private network URLs are not allowed');
    }

    return url;
}

async function assertPublicHttpsUrl(value) {
    const url = parsePublicHttpsUrl(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(hostname)) return url.toString();

    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateIpAddress(address))) {
        throw new Error('URL hostname resolves to a private or invalid address');
    }

    return url.toString();
}

function createPublicDnsLookup(lookup = dns.lookup) {
    return (hostname, options, callback) => {
        const done = typeof options === 'function' ? options : callback;
        const lookupOptions = typeof options === 'object' && options ? options : {};

        Promise.resolve(lookup(hostname, {
            all: true,
            verbatim: true,
            family: lookupOptions.family || 0
        })).then((addresses) => {
            if (!Array.isArray(addresses) || addresses.length === 0 ||
                addresses.some(({ address }) => isPrivateIpAddress(address))) {
                throw new Error('URL hostname resolves to a private or invalid address');
            }

            const [{ address, family }] = addresses;
            done(null, address, family);
        }).catch((error) => done(error));
    };
}

/**
 * Builds transport options for user-supplied outbound HTTPS requests.
 *
 * The hostname is checked once when a URL is accepted and again by the TLS
 * agent immediately before connection. This prevents DNS rebinding between
 * validation and use. Callers must spread these options into axios/node-fetch
 * requests instead of accepting a caller-provided agent, proxy or redirect.
 */
async function createSafeHttpsRequest(value) {
    const url = await assertPublicHttpsUrl(value);
    return {
        url,
        httpsAgent: new https.Agent({
            keepAlive: false,
            lookup: createPublicDnsLookup()
        }),
        maxRedirects: 0,
        proxy: false
    };
}

module.exports = {
    assertPublicHttpsUrl,
    createPublicDnsLookup,
    createSafeHttpsRequest,
    isPrivateIpAddress,
    parsePublicHttpsUrl
};
