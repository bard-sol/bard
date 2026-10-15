import sheet from "../../engine/units-s0-v2.json";

export const SHEET = sheet;

const SHORT: Record<string, string> = {
  "Kesh Varrow, the Ledger-Lord": "Kesh Varrow",
  "Running-Sea Deckhand": "Deckhand",
  "Palimpsest Copyist": "Copyist",
  "Breathing Portrait": "Portrait",
  "Lanternfall Novice": "Novice",
  "Muster Drummer": "Drummer",
  "Old Mother Index": "Mother Index",
  "The Weeping Margin": "Weeping Margin",
  "The Watching Reader": "The Reader",
  "Hob the Bookbinder": "Hob",
  "The Margin Wolf": "Margin Wolf",
  "Grenna Ironvow": "Grenna",
  "Deckle Hunter": "Deckle Hunter",
  "Hinge Duellist": "Duellist",
  "Sump Brawler": "Sump Brawler",
};

const MINI: Record<string, string> = {
  sump_brawler: "Brawler",
  copyist: "Copyist",
  portrait: "Portrait",
  deckhand: "Deckhand",
  novice: "Novice",
  drummer: "Drummer",
  hunter: "Hunter",
  duellist: "Duellist",
  blotling: "Blotling",
  footnote: "Footnote",
  juniper: "Juniper",
  corvin: "Corvin",
  wren: "Wren",
  croak: "Croak",
  grub: "Grub",
  doodle: "Doodle",
  pip: "Pip",
  index: "Index",
  kesh: "Kesh",
  hob: "Hob",
  wolf: "Wolf",
  weeping: "Weeping",
  thorn: "Thorn",
  grenna: "Grenna",
  silas: "Silas",
  marrow: "Marrow",
  wick: "Old Wick",
  vey: "Vey",
  reader: "Reader",
  ash_ember: "Ash & Ember",
  errata: "Errata",
  colophon: "Colophon",
  ink_drop: "Ink Drop",
  ink_drop_2: "Ink Drop",
  scribble: "Scribble",
  scribble_2: "Scribble",
  ember: "Ember",
};

const HOUSE_KEY: Record<string, string> = {
  "The Pit": "pit",
  "The Scriptorium": "scriptorium",
  "The Gilt": "gilt",
  "The Tidewrack": "tidewrack",
  "The Candle": "candle",
  "The Standard": "standard",
  "The Torn Margin": "torn",
  "The Fold": "fold",
  Neutral: "neutral",
};

const KW_ICON: Record<string, string> = {
  "Start of fight": "start_of_fight",
  "On attack": "on_attack",
  "On hurt": "on_hurt",
  "On death": "on_death",
  "On ally death": "on_ally_death",
  Ward: "ward",
  Summon: "summon",
  Silence: "silence",
  "On reveal": "on_reveal",
  Ongoing: "ongoing",
  Afterlife: "on_death",
  Arrive: "ongoing",
  Frenzy: "on_attack",
  Guard: "ward",
  Endure: "hp",
  Snipe: "on_attack",
  Pierce: "atk",
  Shelter: "ward",
  Blight: "silence",
  Filed: "silence",
  Foresight: "start_of_fight",
  Stitch: "summon",
  Echo: "on_death",
  Brace: "hp",
};

const TRIG: Record<string, string> = {
  start_of_fight: "Start of fight",
  on_attack: "On attack",
  on_hurt: "On hurt",
  on_death: "On death",
  on_ally_death: "On ally death",
  passive: "Ongoing",
};

export const GLOSSARY = sheet.keywords as Record<string, string>;

export interface CardFace {
  id: string;
  name: string;
  short: string;
  mini: string;
  house: string;
  houseName: string;
  kind: string;
  tier: number;
  cost: number;
  atk: number;
  hp: number;
  text: string;
  kw: string[];
  mAtk: number;
  mHp: number;
  mText: string;
  flavour: string;
  glue: string[];
}

const KIND: Record<string, string> = {
  "rank-and-file": "Unit",
  named: "Named unit",
  hero: "Hero",
  blot: "Blot",
  creature: "Creature",
  ally: "Ally",
  reader: "Reader",
};

function kwIcons(labels: string[], trigger: string): string[] {
  const icons = labels.map((k) => KW_ICON[k] ?? KW_ICON[k.split(" ")[0] ?? ""] ?? "").filter(Boolean);
  const trig = trigger === "passive" ? "ongoing" : trigger;
  if (trig && !icons.includes(trig) && (trig in { start_of_fight: 1, on_attack: 1, on_hurt: 1, on_death: 1, on_ally_death: 1, ongoing: 1 })) {
    icons.unshift(trig);
  }
  return [...new Set(icons)];
}

function faceOf(u: (typeof sheet.units)[number], merged: boolean): CardFace {
  const ab = merged ? u.merged.ability : u.ability;
  const labels = (merged ? u.merged.keywords : u.keywords) ?? [];
  return {
    id: u.id,
    name: u.name,
    short: SHORT[u.name] ?? u.name,
    mini: MINI[u.id] ?? SHORT[u.name] ?? u.name,
    house: HOUSE_KEY[u.house] ?? "neutral",
    houseName: u.house,
    kind: KIND[u.kind] ?? u.kind,
    tier: u.tier,
    cost: u.cost,
    atk: merged ? u.merged.attack : u.attack,
    hp: merged ? u.merged.health : u.health,
    text: ab?.text ?? "",
    kw: kwIcons(labels, ab?.trigger ?? "passive"),
    mAtk: u.merged.attack,
    mHp: u.merged.health,
    mText: u.merged.ability?.text ?? "",
    flavour: u.flavour ?? "",
    glue: u.glue ?? [],
  };
}

const byId = new Map(sheet.units.map((u) => [u.id, u]));

export function face(id: string, copies = 1): CardFace {
  const u = byId.get(id);
  if (!u) {
    const mini = MINI[id] ?? id;
    return {
      id,
      name: mini,
      short: mini,
      mini,
      house: "neutral",
      houseName: "Neutral",
      kind: "Token",
      tier: 0,
      cost: 0,
      atk: 1,
      hp: 1,
      text: "",
      kw: ["summon"],
      mAtk: 1,
      mHp: 1,
      mText: "",
      flavour: "",
      glue: [],
    };
  }
  const base = faceOf(u, copies >= 3);
  if (copies === 2) {
    base.atk += 1;
    base.hp += 1;
  }
  return base;
}

export function artSrc(id: string): string {
  if (id === "ink_drop" || id === "ink_drop_2") return "/art/v2/units/token_inkdrop.webp";
  if (id === "scribble" || id === "scribble_2") return "/art/v2/units/token_scribble.webp";
  if (id === "ember") return "/art/v2/units/ash_ember.webp";
  return `/art/v2/units/${id}.webp`;
}

export function linesSrc(id: string): string {
  if (id === "ink_drop" || id === "ink_drop_2") return "/art/v2/units/token_inkdrop-lines.webp";
  if (id === "scribble" || id === "scribble_2") return "/art/v2/units/token_scribble-lines.webp";
  if (id === "ember") return "/art/v2/units/ash_ember-lines.webp";
  return `/art/v2/units/${id}-lines.webp`;
}

export function houseKey(nameOrId: string): string {
  if (HOUSE_KEY[nameOrId]) return HOUSE_KEY[nameOrId]!;
  if (nameOrId === "tornmargin") return "torn";
  return nameOrId || "neutral";
}

export function trigLabel(key: string): string {
  return TRIG[key] ?? key.replaceAll("_", " ");
}

export function kwName(icon: string): string {
  const hit = Object.entries(KW_ICON).find(([, v]) => v === icon);
  return hit?.[0] ?? trigLabel(icon);
}

export function kwDef(icon: string): string {
  const name = kwName(icon);
  return GLOSSARY[name] ?? GLOSSARY[icon] ?? "";
}

export const BARD_ART = "/art/v2/bard.webp";
