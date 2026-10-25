import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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
