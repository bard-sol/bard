export interface Fx {
  splat(x: number, y: number, dmg: number): void;
  thread(x1: number, y1: number, x2: number, y2: number): void;
  resize(): void;
  destroy(): void;
}

const noop: Fx = { splat() {}, thread() {}, resize() {}, destroy() {} };

/** Full-viewport Pixi layer for hit splats and trigger threads. */
export async function createFx(host: HTMLElement): Promise<Fx> {
  try {
    const { Application, Assets, Graphics, Sprite } = await import("pixi.js");
    const app = new Application();
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    await app.init({ width: w, height: h, backgroundAlpha: 0, antialias: true, preference: "webgl" });
    const canvas = app.canvas;
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:20";
    host.appendChild(canvas);
    let splatTex: unknown = null;
    try {
      splatTex = await Assets.load("/art/v2/splat-2.webp");
    } catch {
      splatTex = null;
    }
    const resize = () => {
      const nw = Math.max(1, host.clientWidth);
      const nh = Math.max(1, host.clientHeight);
      app.renderer.resize(nw, nh);
    };
    return {
      resize,
      splat(x, y, dmg) {
        const sc = Math.min(1.1, 0.55 + 0.08 * Math.max(1, dmg));
        if (splatTex) {
          const s = new Sprite(splatTex as ConstructorParameters<typeof Sprite>[0]);
          s.anchor.set(0.5);
          s.position.set(x, y);
          s.scale.set(0);
          app.stage.addChild(s);
          const t0 = performance.now();
          const step = () => {
            const k = Math.min(1, (performance.now() - t0) / 120);
            s.scale.set(sc * (k < 1 ? 1.1 * k : 1));
            if (k < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
          window.setTimeout(() => s.destroy(), 720);
          return;
        }
        const g = new Graphics();
        g.circle(x, y, 18 + dmg).fill({ color: 0x0a0c10, alpha: 0.85 });
        app.stage.addChild(g);
        window.setTimeout(() => g.destroy(), 720);
      },
      thread(x1, y1, x2, y2) {
        const g = new Graphics();
        g.moveTo(x1, y1).quadraticCurveTo((x1 + x2) / 2, Math.min(y1, y2) - 24, x2, y2).stroke({
          color: 0xf1ebdf,
          width: 1.75,
          alpha: 0.8,
        });
        app.stage.addChild(g);
        window.setTimeout(() => g.destroy(), 480);
      },
      destroy() {
        app.destroy(true);
      },
    };
  } catch {
    return noop;
  }
}
