/* Bard — House bar: live ink flow between the 8 House colours.
   Framework-free. Renders into any 2D canvas; in PixiJS use
   PIXI.Texture.from(bar.canvas) and call texture.update() after bar.frame(t).
   API:
     const bar = new HouseBar({width:366, height:24, dpr:2, you:'tidewrack', rival:'pit'});
     bar.setHealth({pit:118, ...})        // absolute House health; widths are shares
     bar.win()                             // brief rule: your House +3, rival -4, with flow FX
     bar.eliminate('fold')                 // drains to bare ink line
     bar.frame(tMs)                        // draw one frame (call every rAF)
*/
(function (root) {
  const HOUSES = [
    ['pit', '#D9481C', '#4A4E54'], ['scriptorium', '#1E7F72', '#23262E'],
    ['gilt', '#D4B25A', '#F3ECDA'],            // flat matte wash, never metallic
    ['tidewrack', '#6FB3DD', '#C9A97E'], ['candle', '#8E2F5E', '#8B8580'],
    ['standard', '#2B4F8C', '#A7A9A6'], ['tornmargin', '#C8862A', '#5E6B34'],
    ['fold', '#E4DCC8', '#5B5D63']];
  const PAPER = [243, 234, 215], INK = [27, 23, 18];
  const hex = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
  // deterministic value noise
  function hash(x, y) { let h = x * 374761393 + y * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, y) => 0.6 * vnoise(x, y) + 0.3 * vnoise(x * 2.1, y * 2.1) + 0.1 * vnoise(x * 4.3, y * 4.3);
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  class HouseBar {
    constructor(o = {}) {
      this.w = o.width || 366; this.h = o.height || 24; this.dpr = o.dpr || 2;
      this.you = o.you || 'tidewrack'; this.rival = o.rival || 'pit';
      this.canvas = o.canvas || document.createElement('canvas');
      this.canvas.width = this.w * this.dpr; this.canvas.height = this.h * this.dpr;
      this.ctx = this.canvas.getContext('2d');
      this.img = this.ctx.createImageData(this.canvas.width, this.canvas.height);
      this.houses = HOUSES.map(([k, a, b], i) => ({ k, i, A: hex(a), B: hex(b), hp: 100, shown: 100, from: 100, to: 100, t0: 0, dead: false, pulse: -1e9 }));
      this.drops = []; this.labels = []; this.now = 0;
      this.TWEEN = 1200;               // ms, width re-flow after a score change
    }
    get(k) { return this.houses.find(h => h.k === k); }
    setHealth(map, animate = true) {
      for (const h of this.houses) if (map[h.k] != null) {
        h.from = h.shown; h.to = map[h.k]; h.t0 = this.now; if (!animate) h.shown = h.from = h.to;
      }
    }
    win(you = this.you, rival = this.rival, heal = 3, hit = 4) {
      const Y = this.get(you), R = this.get(rival);
      this.setHealth({ [you]: Y.to + heal, [rival]: Math.max(0, R.to - hit) });
      const xr = this.center(R), xy = this.center(Y);
      for (let i = 0; i < 14; i++) this.drops.push({ x0: xr, x1: xy, t0: this.now + i * 45, dur: 700 + (i % 4) * 60, y: 0.35 + 0.35 * hash(i, 7), col: Y.A, r: 1.2 + hash(i, 3) * 1.6 });
      Y.pulse = this.now + 650; R.pulse = this.now;
      this.labels.push({ k: you, txt: '+' + heal, t0: this.now + 700 }, { k: rival, txt: '\u2212' + hit, t0: this.now });
    }
    eliminate(k) { const h = this.get(k); h.dead = true; h.from = h.shown; h.to = 0; h.t0 = this.now; }
    layout() {
      const MIN = 5; // px width a fallen House keeps (bare ink line)
      const live = this.houses.filter(h => !h.dead || h.shown > .01);
      const total = this.houses.reduce((s, h) => s + Math.max(h.shown, 0), 0) || 1;
      const deadCount = this.houses.filter(h => h.dead).length;
      const avail = this.w - deadCount * MIN;
      let x = 0;
      for (const h of this.houses) {
        const w = (h.dead ? MIN : 0) + avail * Math.max(h.shown, 0) / total;
        h.x0 = x; h.x1 = x + w; x += w;
      }
    }
    center(h) { this.layout(); return (h.x0 + h.x1) / 2; }
    frame(t) {
      this.now = t;
      for (const h of this.houses) {
        const p = Math.min(1, Math.max(0, (t - h.t0) / this.TWEEN));
        h.shown = h.from + (h.to - h.from) * ease(p);
      }
      this.layout();
      const W = this.canvas.width, H = this.canvas.height, d = this.dpr, data = this.img.data, ts = t / 1000;
      const bounds = this.houses.map(h => h.x1 * d);
      for (let py = 0; py < H; py++) {
        const yy = py / d;
        for (let px = 0; px < W; px++) {
          const xx = px / d;
          // which House owns this pixel (boundaries wobble like wet ink)
          let idx = 0, edge = 1e9;
          for (let k = 0; k < 8; k++) {
            const wob = 1.6 * Math.sin(yy * 0.55 + ts * 1.7 + k * 1.9) + 1.4 * (vnoise(yy * 0.35 + k * 9, ts * 0.9) - .5);
            const b = bounds[k] / d + (k < 7 ? wob : 0);
            if (xx > b) idx = k + 1;
            edge = Math.min(edge, Math.abs(xx - b));
          }
          idx = Math.min(idx, 7);
          const h = this.houses[idx];
          let r, g, b;
          if (h.dead) {          // drained: paper with black line hatch — a Margin statue
            const line = ((px + py) % 6 < 1.4) ? 1 : 0;
            r = line ? INK[0] : PAPER[0]; g = line ? INK[1] : PAPER[1]; b = line ? INK[2] : PAPER[2];
          } else {
            const dir = (h.k === this.you ? 1 : -1);
            const n = fbm((xx - dir * ts * 6) * 0.09 + idx * 11, yy * 0.18 + ts * 0.15);
            const mixB = Math.max(0, Math.min(1, (n - 0.52) * 2.4)) * 0.45;
            r = h.A[0] + (h.B[0] - h.A[0]) * mixB; g = h.A[1] + (h.B[1] - h.A[1]) * mixB; b = h.A[2] + (h.B[2] - h.A[2]) * mixB;
            // watercolour bloom (lighter) and pooled dark edge at boundaries
            const bloom = (fbm(xx * 0.05 + ts * 0.2, yy * 0.2 + idx) - .5) * 0.18;
            let k = 1 + bloom - (edge < 2.2 ? 0.28 * (1 - edge / 2.2) : 0);
            const pu = (t - h.pulse); if (pu > 0 && pu < 700) k += 0.22 * Math.sin(Math.PI * pu / 700) * (h.k === this.you ? 1 : -1);
            r *= k; g *= k; b *= k;
          }
          const grain = (hash(px, py) - .5) * 14;
          const o = (py * W + px) * 4;
          data[o] = r + grain; data[o + 1] = g + grain; data[o + 2] = b + grain; data[o + 3] = 255;
        }
      }
      const c = this.ctx; c.putImageData(this.img, 0, 0);
      c.save(); c.scale(d, d);
      // droplets: ink carried from the rival's segment into yours
      this.drops = this.drops.filter(p => t < p.t0 + p.dur + 50);
      for (const p of this.drops) {
        const q = (t - p.t0) / p.dur; if (q < 0 || q > 1) continue;
        const e = ease(q), x = p.x0 + (p.x1 - p.x0) * e, y = this.h * p.y - Math.sin(Math.PI * q) * this.h * 0.25;
        c.fillStyle = `rgb(${p.col.map(v => v * .8).join(',')})`; c.strokeStyle = 'rgba(27,23,18,.9)'; c.lineWidth = .8;
        c.beginPath(); c.ellipse(x, y, p.r * (1 + .8 * Math.sin(Math.PI * q)), p.r, 0, 0, 7); c.fill(); c.stroke();
      }
      // ink frame (double pen line)
      c.strokeStyle = '#1B1712'; c.lineWidth = 2; c.strokeRect(1, 1, this.w - 2, this.h - 2);
      c.globalAlpha = .4; c.lineWidth = .8; c.strokeRect(2.6, 2.2, this.w - 5, this.h - 4.6); c.globalAlpha = 1;
      c.restore();
    }
    // floating "+3 / −4" labels live in the DOM/Pixi layer above the bar; this returns them with positions
    activeLabels(t) {
      this.layout();
      return this.labels.filter(l => t - l.t0 < 1400).map(l => { const h = this.get(l.k); return { ...l, x: (h.x0 + h.x1) / 2, a: Math.max(0, Math.min(1, (t - l.t0) / 150)) * (1 - Math.max(0, (t - l.t0 - 1000) / 400)) }; });
    }
  }
  HouseBar.HOUSES = HOUSES;
  root.HouseBar = HouseBar;
})(typeof window !== 'undefined' ? window : globalThis);
