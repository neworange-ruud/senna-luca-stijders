import { deflateSync, inflateSync } from "node:zlib";

/**
 * Minimal dependency-free PNG reader/writer for the asset pipeline. It handles
 * the 8-bit non-interlaced truecolour images that the Layer MCP returns and
 * writes 8-bit RGBA, which is everything the sprite pipeline needs. Keeping it
 * here avoids adding an image dependency to a project that ships no images at
 * runtime beyond the prepared files.
 */
export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(file: Buffer): Bitmap {
  if (!file.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error("Not a PNG file.");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const parts: Buffer[] = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colorType = body[9]!;
      if (body[8] !== 8) throw new Error("Only 8-bit PNG input is supported.");
      if (body[12] !== 0) throw new Error("Interlaced PNG is not supported.");
    } else if (type === "IDAT") {
      parts.push(Buffer.from(body));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`Unsupported PNG colour type ${colorType}.`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(parts));
  const pixels = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  const previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const filter = raw[start]!;
    for (let index = 0; index < stride; index += 1) {
      const value = raw[start + 1 + index]!;
      const left = index >= channels ? line[index - channels]! : 0;
      const up = previous[index]!;
      const upLeft = index >= channels ? previous[index - channels]! : 0;
      const restored =
        filter === 0
          ? value
          : filter === 1
            ? value + left
            : filter === 2
              ? value + up
              : filter === 3
                ? value + ((left + up) >> 1)
                : value + paeth(left, up, upLeft);
      line[index] = restored & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      pixels[target] = line[source]!;
      pixels[target + 1] = line[source + 1]!;
      pixels[target + 2] = line[source + 2]!;
      pixels[target + 3] = channels === 4 ? line[source + 3]! : 255;
    }
    previous.set(line);
  }
  return { width, height, data: pixels };
}

function chunk(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length, 0);
  header.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), body])), 0);
  return Buffer.concat([header, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function encodePng(bitmap: Bitmap): Buffer {
  const stride = bitmap.width * 4;
  const raw = Buffer.alloc((stride + 1) * bitmap.height);
  for (let y = 0; y < bitmap.height; y += 1) {
    // Filter 1 (Sub) compresses flat cartoon artwork well and stays cheap.
    raw[y * (stride + 1)] = 1;
    for (let index = 0; index < stride; index += 1) {
      const value = bitmap.data[y * stride + index]!;
      const left = index >= 4 ? bitmap.data[y * stride + index - 4]! : 0;
      raw[y * (stride + 1) + 1 + index] = (value - left) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(bitmap.width, 0);
  header.writeUInt32BE(bitmap.height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
