import { Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { Container } from 'pixi.js';
import type { Rect } from './layout.js';
import { houseTint, tokens } from './tokens.js';

let map: Record<string, string> = {};
const textures = new Map<string, Texture>();

export async function preloadArt(): Promise<void> {
  try {
    const response = await fetch('/art-map.json');
    if (!response.ok) return;
    const parsed = (await response.json()) as unknown;
    if (!parsed || typeof parsed !== 'object') return;
    map = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return;
  }
  await Promise.all(
    Object.entries(map).map(async ([id, url]) => {
      try {
        textures.set(id, await Texture.from(url));
      } catch {
        textures.delete(id);
      }
    }),
  );
}

export function artUrl(cardId: string): string | null {
  return map[cardId] ?? null;
}

/** Card, unit, or Legend portrait. A missing cutout is a House-coloured initial, never an empty frame. */
export function paintPortrait(root: Container, rect: Rect, cardId: string, house: string, name: string): void {
  const texture = textures.get(cardId);
  if (texture) {
    const sprite = new Sprite(texture);
    sprite.x = rect.x;
    sprite.y = rect.y;
    sprite.width = rect.w;
    sprite.height = rect.h;
    root.addChild(sprite);
    return;
  }
  const plate = new Graphics();
  plate.roundRect(rect.x, rect.y, rect.w, rect.h, 8).fill({ color: houseTint(house) });
  root.addChild(plate);
  const letter = (name.trim()[0] ?? '?').toUpperCase();
  const initial = new Text({
    text: letter,
    style: { fill: tokens.color.ink, fontFamily: tokens.font.display, fontSize: Math.max(12, Math.floor(Math.min(rect.w, rect.h) * 0.46)) },
  });
  initial.anchor.set(0.5);
  initial.x = rect.x + rect.w / 2;
  initial.y = rect.y + rect.h / 2;
  root.addChild(initial);
}
