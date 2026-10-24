import data from "../../engine/duel-b-v2.json";

export type AbilityKind = "afterlife" | "reveal" | "ongoing" | "arrive" | "vanilla";

export interface CardDef {
  id: string;
  name: string;
  house: string;
  cost: number;
  power: number;
  kind: AbilityKind;
  text: string;
  keywords: string[];
}

export const CARDS: CardDef[] = data.cards.map((c) => ({
  id: c.id,
  name: c.name,
  house: c.house,
  cost: c.cost,
  power: c.power,
  kind: (c.kind as AbilityKind) || "vanilla",
  text: c.ability_text,
  keywords: c.keywords,
}));

const byId = new Map(CARDS.map((c) => [c.id, c]));
const tokens = data.tokens as Record<string, { name: string; power: number }>;

export function card(id: string): CardDef {
  const tok = tokens[id];
  if (tok) {
    return { id, name: tok.name.replace(" [PLACEHOLDER]", ""), house: "Neutral", cost: 0, power: tok.power, kind: "vanilla", text: "", keywords: [] };
  }
  const found = byId.get(id);
  if (!found) throw new Error(`unknown card ${id}`);
  return found;
}

export interface StarterDeck {
  id: string;
  name: string;
  cards: string[];
}

const DECK_IDS: [string, string][] = [
  ["ranks", "Ranks Close"],
  ["rewrite", "Rewrite"],
  ["fang", "Coin and Fang"],
  ["tide", "Ink Tide"],
];

export const STARTERS: StarterDeck[] = DECK_IDS.map(([id, name]) => ({
  id,
  name,
  cards: [...(data.starter_decks as Record<string, string[]>)[name]!],
}));

export function starter(id: string): StarterDeck {
  return STARTERS.find((d) => d.id === id) ?? STARTERS[0]!;
}

export const LOCATIONS = data.locations;
export const DUEL_DATA = data;

export function locationName(id: string): string {
  return LOCATIONS.find((l) => l.id === id)?.name ?? id;
}

export function locationText(id: string): string {
  return LOCATIONS.find((l) => l.id === id)?.text ?? "";
}
