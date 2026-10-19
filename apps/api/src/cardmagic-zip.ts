/**
 * Minimal ZIP reader for CardMagic responses (STORE + DEFLATE local-file entries).
 * No new dependency: CardMagic ZIPs are small and well-formed.
 */
import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const SIG_LOCAL = 0x04034b50;

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

/** Unpack a CardMagic ZIP into named file entries (paths normalized to basename). */
export function unzipCardMagicArchive(bytes: Uint8Array): ZipEntry[] {
  const out: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    if (readU32(bytes, offset) !== SIG_LOCAL) break;
    const method = readU16(bytes, offset + 8);
    const compSize = readU32(bytes, offset + 18);
    const nameLen = readU16(bytes, offset + 26);
    const extraLen = readU16(bytes, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    if (dataStart + compSize > bytes.length) break;
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLen);
    const name = Buffer.from(nameBytes).toString("utf8").replace(/^.*[/\\]/, "");
    const compressed = bytes.subarray(dataStart, dataStart + compSize);
    let data: Uint8Array;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      data = new Uint8Array(inflateRawSync(compressed));
    } else {
      offset = dataStart + compSize;
      continue;
    }
    if (name && !name.endsWith("/")) out.push({ name, data });
    offset = dataStart + compSize;
  }
  return out;
}
