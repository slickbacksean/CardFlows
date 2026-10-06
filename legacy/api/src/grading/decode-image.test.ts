import { describe, expect, it } from 'vitest';
import { isDecodableRasterImage } from './decode-image.js';

const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const MINIMAL_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff,
  0xd9,
]);

const MINIMAL_WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8L'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
]);

describe('isDecodableRasterImage', () => {
  it('accepts PNG, JPEG, and WebP headers', () => {
    expect(isDecodableRasterImage(MINIMAL_PNG)).toBe(true);
    expect(isDecodableRasterImage(MINIMAL_JPEG)).toBe(true);
    expect(isDecodableRasterImage(MINIMAL_WEBP)).toBe(true);
  });

  it('rejects non-image bytes', () => {
    expect(isDecodableRasterImage(Buffer.from('not-an-image'))).toBe(false);
    expect(isDecodableRasterImage(Buffer.from([0xff, 0xd8]))).toBe(false);
  });
});
