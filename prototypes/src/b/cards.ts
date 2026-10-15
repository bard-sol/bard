/** Prototype B cards. Names are the 32 story units. Cost and power are the Margin Duel table. */

export type AbilityKind = "vanilla" | "or" | "on";

export interface CardDef {
  id: string;
  name: string;
  cost: number;
  power: number;
  kind: AbilityKind;
  text: string;
}

export const CARDS: CardDef[] = [
  { id: "sump_brawler", name: "Sump Brawler", cost: 1, power: 2, kind: "vanilla", text: "" },
  { id: "novice", name: "Lanternfall Novice", cost: 1, power: 1, kind: "or", text: "On reveal: +1 power to another of your cards here." },
  { id: "drummer", name: "Muster Drummer", cost: 1, power: 1, kind: "on", text: "Ongoing: your other cards here have +1 power." },
  { id: "hunter", name: "Deckle Hunter", cost: 1, power: 1, kind: "or", text: "On reveal: +2 power if an enemy card is already here." },
  { id: "blotling", name: "The Blotling", cost: 1, power: 1, kind: "or", text: "On reveal: add a 1-power Ink Drop to another lane of yours, if there's room." },
  { id: "portrait", name: "Breathing Portrait", cost: 1, power: 2, kind: "vanilla", text: "" },
  { id: "deckhand", name: "Running-Sea Deckhand", cost: 2, power: 3, kind: "vanilla", text: "" },
  { id: "duellist", name: "Hinge Duellist", cost: 2, power: 3, kind: "vanilla", text: "" },
  { id: "copyist", name: "Palimpsest Copyist", cost: 2, power: 2, kind: "or", text: "On reveal: the strongest enemy card here loses 1 power." },
  { id: "footnote", name: "Sir Footnote", cost: 2, power: 2, kind: "or", text: "On reveal: +2 power if an enemy card here has more power than this." },
  { id: "juniper", name: "Juniper", cost: 2, power: 2, kind: "or", text: "On reveal: you see the next card the enemy will draw." },
  { id: "corvin", name: "Corvin", cost: 2, power: 1, kind: "or", text: "On reveal: draw a card." },
  { id: "doodle", name: "Deckle Doodle", cost: 2, power: 3, kind: "vanilla", text: "" },
  { id: "wren", name: "Sister Wren", cost: 3, power: 3, kind: "on", text: "Ongoing: your other cards here can't lose power." },
  { id: "croak", name: "Baron Croak", cost: 3, power: 4, kind: "vanilla", text: "" },
  { id: "grub", name: "Grub", cost: 3, power: 4, kind: "on", text: "Ongoing: can't be moved or destroyed." },
  { id: "pip", name: "Pip Fennick", cost: 3, power: 1, kind: "or", text: "On reveal: flip the Crown Coin. +5 power or +0." },
  { id: "index", name: "Old Mother Index", cost: 3, power: 3, kind: "or", text: "On reveal: enemy Ongoing abilities here stop." },
  { id: "wolf", name: "The Margin Wolf", cost: 3, power: 3, kind: "or", text: "On reveal: +3 power if you're losing this lane." },
  { id: "grenna", name: "Grenna Ironvow", cost: 4, power: 6, kind: "vanilla", text: "" },
  { id: "kesh", name: "Kesh Varrow, the Ledger-Lord", cost: 4, power: 3, kind: "or", text: "On reveal: destroy another of your cards here and gain its power." },
  { id: "thorn", name: "Thorn", cost: 4, power: 4, kind: "or", text: "On reveal: +3 power if Thorn is your only card here." },
  { id: "hob", name: "Hob the Bookbinder", cost: 4, power: 3, kind: "on", text: "Ongoing: your other cards here have +1 power." },
  { id: "weeping", name: "The Weeping Margin", cost: 4, power: 4, kind: "on", text: "Ongoing: enemy cards here have −1 power." },
  { id: "reader", name: "The Watching Reader", cost: 4, power: 2, kind: "on", text: "Ongoing: your cards in the adjacent lanes have +1 power." },
  { id: "marrow", name: "Lady Marrow", cost: 5, power: 5, kind: "on", text: "Ongoing: if you're winning this lane at game end, +3 power." },
  { id: "silas", name: "Silas Quill", cost: 5, power: 4, kind: "or", text: "On reveal: move the strongest enemy card here to another lane (the leftmost with room)." },
  { id: "wick", name: "Old Wick", cost: 5, power: 4, kind: "or", text: "On reveal: +4 power if you played a card here last turn." },
  { id: "vey", name: "Captain Vey", cost: 5, power: 5, kind: "on", text: "Ongoing: your 1- and 2-cost cards in every lane have +1 power." },
  { id: "ash_ember", name: "Ash & Ember", cost: 6, power: 5, kind: "or", text: "On reveal: add a 5-power Ember to another lane of yours, if there's room." },
  { id: "errata", name: "Sir Errata", cost: 6, power: 7, kind: "or", text: "On reveal: destroy the lowest-power enemy card here." },
  { id: "colophon", name: "The Colophon", cost: 6, power: 11, kind: "or", text: "On reveal: destroy your other cards here." },
];

const byId = new Map(CARDS.map((c) => [c.id, c]));

export function card(id: string): CardDef {
  if (id === "ink_drop") return { id, name: "Ink Drop", cost: 0, power: 1, kind: "vanilla", text: "" };
  if (id === "ember") return { id, name: "Ember", cost: 0, power: 5, kind: "vanilla", text: "" };
  const found = byId.get(id);
  if (!found) throw new Error(`unknown card ${id}`);
  return found;
}

export interface StarterDeck {
  id: string;
  name: string;
  cards: string[];
}

export const STARTERS: StarterDeck[] = [
  {
    id: "ranks",
    name: "Ranks Close",
    cards: ["drummer", "footnote", "vey", "hob", "novice", "wren", "croak", "grub", "deckhand", "sump_brawler", "grenna", "errata"],
  },
  {
    id: "rewrite",
    name: "Rewrite",
    cards: ["copyist", "index", "silas", "wick", "juniper", "corvin", "weeping", "reader", "duellist", "portrait", "marrow", "colophon"],
  },
  {
    id: "fang",
    name: "Coin and Fang",
    cards: ["pip", "hunter", "thorn", "wolf", "juniper", "deckhand", "doodle", "blotling", "croak", "kesh", "ash_ember", "grenna"],
  },
  {
    id: "tide",
    name: "Ink Tide",
    cards: ["blotling", "doodle", "kesh", "weeping", "hob", "reader", "marrow", "wren", "sump_brawler", "duellist", "ash_ember", "colophon"],
  },
];

export function starter(id: string): StarterDeck {
  return STARTERS.find((d) => d.id === id) ?? STARTERS[0]!;
}
