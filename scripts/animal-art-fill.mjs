/**
 * How much of its frame does each animal avatar actually fill?
 *
 *   node scripts/animal-art-fill.mjs
 *
 * `Avatar` renders the art with `object-contain` inside a square box, so the
 * limiting dimension is the artwork's own longest side — NOT the PNG's canvas.
 * A wide subject (floppy ears) fits to the width and letterboxes, rendering
 * visibly smaller than a compact one even when both files are square. Padding a
 * canvas out to a square therefore changes nothing; only scaling the subject does.
 *
 * This prints the opaque bounding box of every PNG in public/icons/animals so a
 * new animal can be checked against the ones already shipped before it is
 * committed. Anything much below the pack is going to look set back from its
 * neighbours in the standings grid.
 *
 * PNGs are decoded here by hand (zlib inflate + scanline unfilter) so the script
 * needs no dependency the repo doesn't already have. 8-bit, non-interlaced only,
 * which is what every export tool produces by default.
 */
import { readFileSync, readdirSync } from "node:fs";
import { inflateSync } from "node:zlib";

const DIR = new URL("../public/icons/animals/", import.meta.url);

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decode(buf) {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];
  const channels = CHANNELS[colorType];
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} not supported`);
  if (interlace !== 0) throw new Error("interlaced PNGs not supported");
  if (!channels) throw new Error(`colour type ${colorType} not supported`);

  const idat = [];
  let off = 8; // skip the 8-byte signature
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === "IEND") break;
    off += 12 + len; // length + type + data + CRC
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels; // 8-bit, so one byte per channel
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);

  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      cur[i] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/** Bounding box of everything meaningfully opaque. */
function artBounds({ width, height, channels, data }) {
  const stride = width * channels;
  const alpha = channels - 1; // last channel, for both grey+alpha and RGBA
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 16, not 0: antialiased edges trail off into near-invisible pixels that
      // would otherwise inflate every bounding box to the full canvas.
      if (data[y * stride + x * channels + alpha] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".png")).sort();
if (files.length === 0) {
  console.log("No artwork in public/icons/animals yet.");
  process.exit(0);
}

const rows = files.map((file) => {
  const img = decode(readFileSync(new URL(file, DIR)));
  if (img.channels !== 4 && img.channels !== 2) {
    return { file, canvas: `${img.width}x${img.height}`, art: "—", fill: null, note: "no alpha" };
  }
  const art = artBounds(img);
  // object-contain scales the whole CANVAS to fit the square box, so the box is
  // filled by max(canvasW, canvasH). Measuring against the art's own longest side
  // instead would just restate its aspect ratio and score a padded canvas 100%.
  const side = Math.max(img.width, img.height);
  return {
    file,
    canvas: `${img.width}x${img.height}`,
    art: `${art.w}x${art.h}`,
    fill: Math.round((art.h / side) * 100),
    note: img.width === img.height ? "" : "canvas not square",
  };
});

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("FILE", 15) + pad("CANVAS", 11) + pad("ART", 11) + pad("FILLS", 8) + "NOTE");
for (const r of [...rows].sort((a, b) => (b.fill ?? 0) - (a.fill ?? 0))) {
  console.log(
    pad(r.file, 15) + pad(r.canvas, 11) + pad(r.art, 11) +
      pad(r.fill === null ? "—" : `${r.fill}%`, 8) + r.note,
  );
}

const measured = rows.filter((r) => r.fill !== null);
if (measured.length > 1) {
  const best = Math.max(...measured.map((r) => r.fill));
  const laggards = measured.filter((r) => best - r.fill >= 15);
  if (laggards.length > 0) {
    console.log(
      `\n${laggards.map((r) => r.file).join(", ")} render noticeably smaller than the rest.` +
        `\nThe subject is wider than it is tall, so object-contain letterboxes it.` +
        `\nA square canvas will not change this — the artwork itself has to fill the frame.`,
    );
  }
}
