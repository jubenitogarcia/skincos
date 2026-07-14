const assert = require('node:assert/strict');
const test = require('node:test');
const { isPrivateIpAddress, parsePublicHttpsUrl } = require('../publicUrl');

test('accepts credential-free HTTPS public URL syntax', () => {
    assert.equal(parsePublicHttpsUrl('https://cdn.example.com/media/file.jpg').hostname, 'cdn.example.com');
});

test('rejects private, credentialed and non-HTTPS URL syntax before network access', () => {
    for (const value of [
        'http://cdn.example.com/file.jpg',
        'https://user:pass@cdn.example.com/file.jpg',
        'https://localhost/file.jpg',
        'https://127.0.0.1/file.jpg',
        'https://192.168.0.10/file.jpg',
        'https://[::1]/file.jpg',
        'https://cdn.example.com:8443/file.jpg'
    ]) {
        assert.throws(() => parsePublicHttpsUrl(value));
    }

    assert.equal(isPrivateIpAddress('10.0.0.1'), true);
    assert.equal(isPrivateIpAddress('8.8.8.8'), false);
    assert.equal(isPrivateIpAddress('::1'), true);
});
