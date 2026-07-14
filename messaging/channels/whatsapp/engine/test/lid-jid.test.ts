import assert from 'node:assert/strict';
import { getLidFromJid } from '../src/utils/createJid';

assert.equal(getLidFromJid('123456789@lid'), '123456789');
assert.equal(getLidFromJid('5511999999999@s.whatsapp.net'), undefined);
assert.equal(getLidFromJid('123456789@lid:42'), undefined);
assert.equal(getLidFromJid('invalid@other'), undefined);

console.log('LID JID extraction regression checks passed');
