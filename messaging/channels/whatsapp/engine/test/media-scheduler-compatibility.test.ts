import assert from 'node:assert/strict';
import test from 'node:test';

import cron from 'node-cron';
import sharp from 'sharp';

test('media conversion remains compatible with the runtime sharp API', async () => {
  const source = await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 20, g: 40, b: 60 } },
  })
    .png()
    .toBuffer();
  const jpeg = await sharp(source).jpeg().toBuffer();
  const webp = await sharp(source, { animated: true }).webp({ quality: 80 }).toBuffer();

  assert.equal((await sharp(jpeg).metadata()).format, 'jpeg');
  assert.equal((await sharp(webp).metadata()).format, 'webp');
});

test('Chatwoot scheduler can be started and stopped with node-cron', () => {
  const task = cron.schedule('0,30 * * * *', () => undefined, { scheduled: false });

  assert.equal(typeof task.start, 'function');
  assert.equal(typeof task.stop, 'function');
  task.start();
  task.stop();
  task.destroy();
});
