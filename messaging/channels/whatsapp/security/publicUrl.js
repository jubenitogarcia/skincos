const dns = require('dns').promises;
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
    if (hostname.toLowerCase() === 'localhost' ||
        (net.isIP(hostname) && isPrivateIpAddress(hostname))) {
        throw new Error('Private network URLs are not allowed');
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

module.exports = { assertPublicHttpsUrl, isPrivateIpAddress, parsePublicHttpsUrl };
