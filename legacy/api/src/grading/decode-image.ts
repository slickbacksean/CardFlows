const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(bytes: Buffer): boolean {
  if (bytes.length < 24) return false;
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  if (bytes.readUInt32BE(8) !== 13) return false;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return false;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0;
}

function isSofMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function isJpeg(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;

  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    if (marker === 0x00 || marker === 0xff) {
      offset += 1;
      continue;
    }

    if (isSofMarker(marker)) {
      if (offset + 9 >= bytes.length) return false;
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      return width > 0 && height > 0;
    }

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    if (marker === 0xd9 || marker === 0xda) return false;
    if (offset + 4 > bytes.length) return false;
    const size = bytes.readUInt16BE(offset + 2);
    if (size < 2) return false;
    offset += 2 + size;
  }

  return false;
}

function isWebp(bytes: Buffer): boolean {
  if (bytes.length < 16) return false;
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') return false;
  if (bytes.toString('ascii', 8, 12) !== 'WEBP') return false;
  const chunk = bytes.toString('ascii', 12, 16);
  return chunk === 'VP8 ' || chunk === 'VP8L' || chunk === 'VP8X';
}

/** True when the bytes decode as JPEG, PNG, or WebP. No quality or composition claims. */
export function isDecodableRasterImage(bytes: Buffer): boolean {
  return isJpeg(bytes) || isPng(bytes) || isWebp(bytes);
}
