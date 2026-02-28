import { decryptToken, encryptToken } from '@meta/shared';

describe('encrypt/decrypt', () => {
  it('round trips tokens', () => {
    process.env.ENCRYPTION_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
    const token = 'secret-token';
    const encrypted = encryptToken(token);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(token);
  });
});
