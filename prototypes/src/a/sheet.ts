import sheet from "../../engine/units-s0.json";

export const SHEET = sheet;
export const UNITS_VERSION = sheet.version;
export type UnitDef = (typeof sheet.units)[number];
export type Piece = { id: string; copies: number };

const byId = new Map(sheet.units.map((u) => [u.id, u]));

export function unit(id: string): UnitDef {
  const found = byId.get(id);
  if (!found) throw new Error(`unknown unit ${id}`);
  return found;
}

export function unitIds(): string[] {
  return sheet.units.map((u) => u.id);
}

export function unitsInTier(tier: number): string[] {
  return sheet.units.filter((u) => u.tier === tier).map((u) => u.id);
}

const HOUSE_SLUG: Record<string, string> = {
  "The Pit": "pit",
  "The Scriptorium": "scriptorium",
  "The Gilt": "gilt",
  "The Tidewrack": "tidewrack",
  "The Candle": "candle",
  "The Standard": "standard",
  "The Torn Margin": "tornmargin",
  "The Fold": "fold",
};

/** Neutrals have no House wash. Art still needs a fill; these are display-only. */
const NEUTRAL_ART: Record<string, string> = {
  hob: "scriptorium",
  wolf: "tornmargin",
  errata: "standard",
  colophon: "candle",
  blotling: "fold",
  weeping: "tornmargin",
  doodle: "gilt",
  reader: "pit",
};

export function artHouse(id: string): string {
  const house = unit(id).house;
  return HOUSE_SLUG[house] ?? NEUTRAL_ART[id] ?? "fold";
}

export function houseSlug(display: string): string {
  return HOUSE_SLUG[display] ?? "fold";
}

const GLYPH: Record<string, string> = {
  on_attack: "attack",
  on_hurt: "hurt",
  on_death: "death",
  on_ally_death: "allydeath",
  start_of_fight: "start",
};

export function triggerGlyph(trigger: string | undefined): string | null {
  if (!trigger) return null;
  const name = GLYPH[trigger];
  return name ? `/art/glyphs/trigger-${name}.svg` : null;
}

export type ArtState = "idle" | "hit" | "dying" | "ghost";

/** m1 = copies 1 or 2. m2 = three copies (level 2). Level-3 art is unused. */
export function unitArt(id: string, copies: number, state: ArtState = "idle"): string {
  if (id === "ink_drop" || id === "ink_drop_2") return "/art/units/blot-t1.svg";
  if (id === "scribble" || id === "scribble_2") return "/art/units/blot-t2.svg";
  let tier = 1;
  try {
    tier = unit(id).tier;
  } catch {
    tier = 1;
  }
  const merge = copies >= 3 ? 2 : 1;
  if (state === "idle") return `/art/units/u-t${tier}-m${merge}-idle-${artHouse(id)}.svg`;
  return `/art/units/u-t${tier}-m${merge}-${state}.svg`;
}

export function roundStats(id: string, copies: number): { atk: number; hp: number; text: string; trigger: string } {
  const d = unit(id);
  if (copies >= 3) {
    return {
      atk: d.merged.attack,
      hp: d.merged.health,
      text: d.merged.ability?.text ?? "",
      trigger: d.merged.ability?.trigger ?? "",
    };
  }
  const c = Math.max(1, copies);
  return {
    atk: d.attack + (c - 1),
    hp: d.health + (c - 1),
    text: d.ability?.text ?? "",
    trigger: d.ability?.trigger ?? "",
  };
}
