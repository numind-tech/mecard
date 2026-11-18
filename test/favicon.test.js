import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { photoFavicon } from '../favicon.js';

test('JPEG, PNG, GIF and WebP produce a visible square portrait cropped from the top', async () => {
  // A tall portrait: red at the top, blue in the middle and bottom. A centred
  // crop would incorrectly show blue. Decode the PNG with a separate renderer.
  const pixels = Buffer.alloc(96 * 288 * 3);
  for (let y = 0; y < 288; y++) {
    for (let x = 0; x < 96; x++) pixels[(y * 96 + x) * 3 + (y < 96 ? 0 : 2)] = 255;
  }
  for (const format of ['jpeg', 'png', 'gif', 'webp']) {
    const input = await sharp(pixels, { raw: { width: 96, height: 288, channels: 3 } }).toFormat(format).toBuffer();
    const png = await photoFavicon(input);
    assert.equal(png.readUInt32BE(0), 0x89504e47, format);
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, '64x64', format);
    const rendered = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image href="data:image/png;base64,${png.toString('base64')}" width="64" height="64"/></svg>`).render();
    const offset = (32 * 64 + 32) * 4;
    const [r, g, b, a] = rendered.pixels.subarray(offset, offset + 4);
    assert.ok(r > 240 && g < 16 && b < 16 && a === 255, `${format}: expected an opaque red portrait, got ${[r, g, b, a]}`);
  }
});

test('invalid image bytes are rejected instead of producing an empty favicon', async () => {
  await assert.rejects(photoFavicon(Buffer.from('not a photo')));
});
