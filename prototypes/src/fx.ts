export interface Fx {
  splat(x: number, y: number, dmg: number): void;
  thread(x1: number, y1: number, x2: number, y2: number): void;
  destroy(): void;
}

const noop: Fx = { splat() {}, thread() {}, destroy() {} };

/** Fight splats and ink threads. The shop stays DOM; this layer is the Pixi stage. */
export async function createFx(host: HTMLElement): Promise<Fx> {
  try {
    const { Application, Assets, Graphics, Sprite } = await import("pixi.js");
    const app = new Application();
    await app.init({ width: 390, height: 844, backgroundAlpha: 0, antialias: true, preference: "webgl" });
    const canvas = app.canvas;
    canvas.style.width = "390px";
    canvas.style.height = "844px";
    canvas.style.pointerEvents = "none";
    host.appendChild(canvas);
    let splatTex: unknown = null;
    try {
      splatTex = await Assets.load("/art/v2/splat-2.webp");
    } catch {
      splatTex = null;
    }
    return {
      splat(x, y, dmg) {
        if (splatTex) {
          const s = new Sprite(splatTex as ConstructorParameters<typeof Sprite>[0]);
          const sc = Math.min(1.1, 0.45 + 0.06 * Math.max(1, dmg));
          s.anchor.set(0.5);
          s.position.set(x, y);
          s.scale.set(sc);
          app.stage.addChild(s);
          window.setTimeout(() => s.destroy(), 720);
          return;
        }
        const r = Math.min(34, 12 + 4 * Math.max(0, dmg));
        const g = new Graphics();
        g.circle(x, y, r).fill({ color: 0x1b1712, alpha: 0.82 });
        app.stage.addChild(g);
        window.setTimeout(() => g.destroy(), 720);
      },
      thread(x1, y1, x2, y2) {
        const g = new Graphics();
        g.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: 0x1b1712, width: 2, alpha: 0.9 });
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
