export interface Fx {
  splat(x: number, y: number, dmg: number): void;
  thread(x1: number, y1: number, x2: number, y2: number): void;
  destroy(): void;
}

const noop: Fx = { splat() {}, thread() {}, destroy() {} };

/** Fight splats and ink threads. The shop stays DOM; this layer is the Pixi stage. */
export async function createFx(host: HTMLElement): Promise<Fx> {
  try {
    const { Application, Graphics } = await import("pixi.js");
    const app = new Application();
    await app.init({ width: 390, height: 250, backgroundAlpha: 0, antialias: true, preference: "webgl" });
    const canvas = app.canvas;
    canvas.style.width = "390px";
    canvas.style.height = "250px";
    canvas.style.pointerEvents = "none";
    host.appendChild(canvas);
    return {
      splat(x, y, dmg) {
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
