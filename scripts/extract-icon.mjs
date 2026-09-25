// Generates the extension icons from the first frame of the "walk"
// animation in animation.xml (the embedded base64 sprite sheet).
//
//   node scripts/extract-icon.mjs
//
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const xml = readFileSync(resolve(root, 'animation.xml'), 'utf8');

function readInt(re, text) {
  const m = text.match(re);
  return m ? parseInt(m[1], 10) : 0;
}

const tilesX = readInt(/<tilesx>\s*(\d+)\s*<\/tilesx>/, xml);
const tilesY = readInt(/<tilesy>\s*(\d+)\s*<\/tilesy>/, xml);

const pngMatch = xml.match(/<png><!\[CDATA\[([\s\S]*?)\]\]><\/png>/);
if (!pngMatch) throw new Error('No <png> data found in animation.xml');
const pngB64 = pngMatch[1].replace(/\s+/g, '');

// First frame of the "walk" animation.
let frameIndex = 2;
for (const block of xml.split(/<animation\b/)) {
  if (/<name>\s*walk\s*<\/name>/.test(block)) {
    const m = block.match(/<frame>\s*(\d+)\s*<\/frame>/);
    if (m) {
      frameIndex = parseInt(m[1], 10);
      break;
    }
  }
}

const sprite = PNG.sync.read(Buffer.from(pngB64, 'base64'));
const tileW = sprite.width / tilesX;
const tileH = sprite.height / tilesY;
const col = frameIndex % tilesX;
const row = Math.floor(frameIndex / tilesX);
const srcX = col * tileW;
const srcY = row * tileH;

// Copy the tile and treat the sprite's magenta background as transparent.
const tile = Buffer.alloc(tileW * tileH * 4);
for (let y = 0; y < tileH; y++) {
  for (let x = 0; x < tileW; x++) {
    const si = ((srcY + y) * sprite.width + (srcX + x)) * 4;
    const di = (y * tileW + x) * 4;
    const r = sprite.data[si];
    const g = sprite.data[si + 1];
    const b = sprite.data[si + 2];
    const a = sprite.data[si + 3];
    tile[di] = r;
    tile[di + 1] = g;
    tile[di + 2] = b;
    // The XML declares Magenta (255,0,255) as the transparency color.
    tile[di + 3] = (r === 255 && g === 0 && b === 255) ? 0 : a;
  }
}

function nearestScale(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      const si = (sy * sw + sx) * 4;
      const di = (y * dw + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return out;
}

function writePng(size) {
  const data = nearestScale(tile, tileW, tileH, size, size);
  const png = new PNG({ width: size, height: size });
  png.data = data;
  return PNG.sync.write(png);
}

const outDir = resolve(root, 'icons');
mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(outDir, `icon${size}.png`), writePng(size));
  console.log(`wrote icons/icon${size}.png`);
}

console.log(`tiles: ${tilesX}x${tilesY}, tile: ${tileW}x${tileH}, walk frame: ${frameIndex}`);
