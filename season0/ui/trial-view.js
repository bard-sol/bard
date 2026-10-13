/** PixiJS is loaded at runtime as an ES module. No build step. DOM buttons stay the controls. */

const PIXI_SOURCES = [
  'https://cdn.jsdelivr.net/npm/pixi.js@8.14.3/dist/pixi.min.mjs',
  'https://esm.sh/pixi.js@8.14.3'
];

async function loadPixi() {
  let last;
  for (const src of PIXI_SOURCES) {
    try {
      return await import(src);
    } catch (err) {
      last = err;
    }
  }
  throw last || new Error('pixi_unavailable');
}

/**
 * Draws the shared boss and the 3-card hand. Returns engine: 'pixi' or 'dom'.
 * A failed import leaves the DOM board in place.
 */
export async function paintTrial(host, model) {
  if (!host) return { engine: 'dom', destroy() {} };
  host.dataset.trialEngine = 'dom';
  const boss = host.querySelector('[data-trial-boss]');
  if (boss) boss.textContent = model.boss + ' ' + model.intentIcon;
  let app;
  try {
    const PIXI = await loadPixi();
    const canvas = document.createElement('canvas');
    canvas.width = 440;
    canvas.height = 168;
    canvas.setAttribute('data-trial-canvas', 'pixi');
    host.prepend(canvas);
    app = new PIXI.Application();
    await app.init({
      canvas,
      width: 440,
      height: 168,
      background: 0x1a1410,
      antialias: true
    });
    const title = new PIXI.Text({
      text: model.boss + '  ' + model.intentIcon,
      style: { fill: 0xf4efe6, fontSize: 18 }
    });
    title.x = 16;
    title.y = 14;
    app.stage.addChild(title);
    const hp = new PIXI.Graphics();
    const width = Math.max(8, 400 * (model.hpLeft / model.bossHp));
    hp.roundRect(16, 52, width, 14, 4).fill(0xc45c26);
    app.stage.addChild(hp);
    model.hand.forEach((card, index) => {
      const plate = new PIXI.Graphics();
      plate.roundRect(16 + index * 140, 82, 128, 68, 8).fill(0x2a241c);
      app.stage.addChild(plate);
      const label = new PIXI.Text({
        text: card.emoji + ' ' + card.name,
        style: { fill: 0xf4efe6, fontSize: 14 }
      });
      label.x = 28 + index * 140;
      label.y = 104;
      app.stage.addChild(label);
    });
    host.dataset.trialEngine = 'pixi';
    let live = app;
    return {
      engine: 'pixi',
      destroy() {
        if (!live) return;
        const current = live;
        live = null;
        try { current.destroy(true, { children: true }); } catch { /* canvas already removed */ }
      }
    };
  } catch {
    const canvas = host.querySelector('[data-trial-canvas]');
    if (canvas) canvas.remove();
    if (app) {
      try { app.destroy(true); } catch { /* canvas already gone */ }
    }
    host.dataset.trialEngine = 'dom';
    return { engine: 'dom', destroy() {} };
  }
}
