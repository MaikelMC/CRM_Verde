// Genera los íconos placeholder: monograma "LV" sobre verde oscuro. Sin dependencias.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const BG = [11, 61, 46];
const FG = [244, 239, 227];

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    let c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function dist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// "L" y "V" dibujadas con rectángulos y trazos gruesos en un espacio de 512.
function ink(px, py) {
  return (
    (px >= 150 && px <= 208 && py >= 140 && py <= 350) ||
    (px >= 150 && px <= 290 && py >= 292 && py <= 350) ||
    dist(px, py, 300, 140, 365, 350) <= 29 ||
    dist(px, py, 430, 140, 365, 350) <= 29
  );
}

function png(size, scale) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (((x + 0.5) / size - 0.5) * 512) / scale + 256;
      const py = (((y + 0.5) / size - 0.5) * 512) / scale + 256;
      const [r, g, b] = ink(px, py) ? FG : BG;
      const i = y * stride + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync("public/icon-192.png", png(192, 1));
writeFileSync("public/icon-512.png", png(512, 1));
writeFileSync("public/icon-maskable-512.png", png(512, 0.78));
console.log("iconos LV generados");
