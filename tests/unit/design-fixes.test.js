import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const home = readFileSync(path.join(root, 'index.html'), 'utf8');
const explore = readFileSync(path.join(root, 'explore.html'), 'utf8');
const dashboard = readFileSync(path.join(root, 'dashboard.html'), 'utf8');

function lin(c) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}
function lum(rgb) {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}
function contrast(a, b) {
  const light = Math.max(lum(a), lum(b));
  const dark = Math.min(lum(a), lum(b));
  return (light + 0.05) / (dark + 0.05);
}

test('headline is one colour and the scroll cue is gone', () => {
  assert.match(home, /&amp; airdrops\. Simple\./);
  assert.doesNotMatch(home, /<span>Simple\.<\/span>/);
  assert.doesNotMatch(home, /\.hero-title span/);
  assert.doesNotMatch(home, /scroll-hint|scrollHint|>Scroll</);
  assert.doesNotMatch(home, /text-transform:\s*uppercase/);
});

test('spaced capitals are sentence case in the markup', () => {
  assert.match(home, />Launch app</);
  assert.match(home, />For projects</);
  assert.match(home, />Start as a project</);
  assert.match(home, />Built for Solana meme projects</);
  assert.match(home, />What Bard does</);
  assert.match(home, />For meme teams</);
  assert.doesNotMatch(home, /Launch App|For Projects|Start as a Project/);
});

test('smile arc strokes are unchanged and the bloom is not drawn', () => {
  const arc = [
    "tube(cx, cy, r, aEnd, s * 1.45, '#c4b0f4', 0.5 * glow, s * 0.25);",
    "tube(cx, cy, r, aEnd, s * 1.04, '#d8c8fa', 0.98 * ignite, 0);",
    "tube(cx, cy, r, aEnd, s * 0.62, '#f3edff', ignite, 0);",
    "tube(cx, cy, r - s * 0.2, aEnd, s * 0.18, '#ffffff', (0.32 + breath * 0.08) * ignite, s * 0.08);",
  ];
  for (const line of arc) assert.ok(home.includes(line), line);
  assert.doesNotMatch(home, /s \* 3\.6/);
  assert.doesNotMatch(home, /s \* 2\.25/);
  assert.doesNotMatch(home, /createRadialGradient/);
  assert.doesNotMatch(home, /drop-shadow\(0 0 28px/);
  assert.match(home, /overflow-x:\s*clip/);
  assert.match(home, /\.nav-links a\.nav-cta,\s*\.nav-links a\.nav-cta:hover \{\s*color: #0c0c0f;/);
});

test('join and campaigns drop the public label and the dashed box', () => {
  assert.doesNotMatch(explore, /<p class="kicker">Public<\/p>/);
  assert.doesNotMatch(explore, /dashed/);
  assert.match(explore, /Open team admin/);
  assert.match(explore, /No live campaigns/);
  assert.doesNotMatch(dashboard, /dashed/);
  assert.match(dashboard, /Open team admin/);
  assert.match(dashboard, /Connect wallet/);
});

function pngRgba(buf) {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    offset += 4;
    const type = buf.subarray(offset, offset + 4).toString('ascii');
    offset += 4;
    const data = buf.subarray(offset, offset + length);
    offset += length + 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  assert.equal(bitDepth, 8);
  assert.equal(colorType, 6, 'tab icon must be RGBA so the tab can show through');
  assert.equal(interlace, 0);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  let i = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[i++];
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[i++];
      const left = x >= 4 ? out[row + x - 4] : 0;
      const up = y > 0 ? out[row - stride + x] : 0;
      const upLeft = x >= 4 && y > 0 ? out[row - stride + x - 4] : 0;
      let next = value;
      if (filter === 1) next = (value + left) & 255;
      else if (filter === 2) next = (value + up) & 255;
      else if (filter === 3) next = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const paeth = left + up - upLeft;
        const da = Math.abs(paeth - left);
        const db = Math.abs(paeth - up);
        const dc = Math.abs(paeth - upLeft);
        const pred = da <= db && da <= dc ? left : db <= dc ? up : upLeft;
        next = (value + pred) & 255;
      } else if (filter !== 0) {
        throw new Error('unknown png filter ' + filter);
      }
      out[row + x] = next;
    }
  }
  return { width, height, data: out };
}

test('corner mark and tab icon have no black plate', () => {
  assert.match(home, /<link rel="icon" type="image\/png" href="\/favicon.png">/);
  assert.doesNotMatch(home, /rel="icon"[^>]*jpeg|rel="icon"[^>]*BardSmile\.jpg/);
  assert.match(home, /class="nav-logo"[\s\S]*?src="\/transparentbardsmile.png"/);
  assert.match(home, /class="footer-logo"[\s\S]*?src="\/transparentbardsmile.png"/);
  assert.doesNotMatch(home, /\.nav-logo img \{[^}]*border-radius/);
  assert.doesNotMatch(home, /\.footer-logo img \{[^}]*border-radius/);
  assert.doesNotMatch(home, /<img[^>]*src="\/BardSmile\.jpg"/);
  for (const page of [explore, dashboard]) {
    assert.match(page, /<link rel="icon" href="\/favicon.png" type="image\/png">/);
    assert.match(page, /<link rel="apple-touch-icon" href="\/favicon.png">/);
  }

  const icon = pngRgba(readFileSync(path.join(root, 'favicon.png')));
  assert.equal(icon.width, icon.height);
  const px = (x, y) => {
    const i = (y * icon.width + x) * 4;
    return [icon.data[i], icon.data[i + 1], icon.data[i + 2], icon.data[i + 3]];
  };
  for (const [x, y] of [[0, 0], [icon.width - 1, 0], [0, icon.height - 1], [icon.width - 1, icon.height - 1]]) {
    assert.equal(px(x, y)[3], 0, 'corner alpha');
  }
  let opaqueBlack = 0;
  let visible = 0;
  let minX = icon.width;
  let minY = icon.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < icon.height; y++) {
    for (let x = 0; x < icon.width; x++) {
      const [r, g, b, a] = px(x, y);
      if (a > 20) {
        visible++;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (a > 200 && r < 30 && g < 30 && b < 30) opaqueBlack++;
    }
  }
  assert.equal(opaqueBlack, 0);
  assert.ok(visible > 100);
  assert.ok(maxX - minX > maxY - minY, 'the tab mark stays the wide smile');
});

test('changed label colours clear 4.5:1 on the page background', () => {
  const bg = [12, 12, 15];
  const purple = [155, 127, 232];
  const muted = [154, 154, 163];
  const ink = [12, 12, 15];
  assert.ok(contrast(purple, bg) >= 4.5);
  assert.ok(contrast(muted, bg) >= 4.5);
  assert.ok(contrast(ink, purple) >= 4.5);
  const exploreBg = [28, 30, 38];
  const exploreMuted = [161, 161, 170];
  assert.ok(contrast(exploreMuted, exploreBg) >= 4.5);
});
