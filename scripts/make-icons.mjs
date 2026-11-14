// Dibuja los iconos de la extensión (tablero oscuro con una flecha naranja) sin dependencias:
// rasterizado a mano y PNG codificado con zlib.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Forma en coordenadas 0..1: devuelve [r,g,b,a] para un punto
function shade(x, y) {
  const r = 0.16; // esquinas redondeadas
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return [0, 0, 0, 0];
  // Tablero 4×4 de fondo
  const light = (Math.floor(x * 4) + Math.floor(y * 4)) % 2 === 0;
  let c = light ? [0x76, 0x96, 0x56] : [0x4e, 0x6a, 0x3a];
  // Flecha de abajo-izquierda a arriba-derecha
  const ax = 0.22, ay = 0.80, bx = 0.80, by = 0.22;
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  const px = x - ax, py = y - ay;
  const t = px * ux + py * uy, n = Math.abs(-px * uy + py * ux);
  const headL = 0.30;
  const inShaft = t >= 0 && t <= L - headL && n <= 0.075;
  const inHead = t > L - headL && t <= L && n <= (L - t) / headL * 0.21;
  if (inShaft || inHead) c = [0xff, 0xaa, 0x00];
  return [...c, 255];
}

mkdirSync(new URL('../chrome-extension/icons/', import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const S = 4; // supermuestreo para suavizar bordes
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const p = shade((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size);
      acc[0] += p[0] * p[3]; acc[1] += p[1] * p[3]; acc[2] += p[2] * p[3]; acc[3] += p[3];
    }
    const a = acc[3] / (S * S);
    const i = (y * size + x) * 4;
    buf[i] = acc[3] ? acc[0] / acc[3] : 0; buf[i + 1] = acc[3] ? acc[1] / acc[3] : 0; buf[i + 2] = acc[3] ? acc[2] / acc[3] : 0; buf[i + 3] = a;
  }
  writeFileSync(new URL(`../chrome-extension/icons/icon${size}.png`, import.meta.url), png(size, buf));
}
console.log('icons written');
