import type { GhostRecord, ProfileName } from "./duel";
import type { HouseId } from "../houses";
import { starter } from "./cards";

interface SeedGhost {
  id: string;
  name: string;
  house: HouseId;
  renown: number;
  matches: number;
  profile: ProfileName;
  deckId: string;
  raises: number[];
  shuffleSeed: number;
}

/**
 * Day-one opponents. No human recordings yet, so `plays` stays null and the
 * duel fills each turn with the greedy stand-in (most expensive affordable card,
 * into the lane it is losing by the least, ties left). Raise turns are scripted.
 * A stored `plays` list is still accepted by the resolver for a real recording.
 */
const SEEDS: SeedGhost[] = [
  { id: "cinder", name: "Cinder", house: "pit", renown: 8, matches: 3, profile: "Cautious", deckId: "fang", raises: [2], shuffleSeed: 11 },
  { id: "pell", name: "Pell", house: "candle", renown: 7, matches: 5, profile: "Steady", deckId: "ranks", raises: [3], shuffleSeed: 12 },
  { id: "marlow", name: "Marlow", house: "scriptorium", renown: 12, matches: 6, profile: "Bold", deckId: "rewrite", raises: [4, 5], shuffleSeed: 13 },
  { id: "sedge", name: "Sedge", house: "fold", renown: 9, matches: 4, profile: "Cautious", deckId: "tide", raises: [1, 3], shuffleSeed: 14 },
  { id: "arta", name: "Arta", house: "gilt", renown: 48, matches: 30, profile: "Steady", deckId: "ranks", raises: [2, 4], shuffleSeed: 15 },
  { id: "holm", name: "Holm", house: "standard", renown: 36, matches: 22, profile: "Bold", deckId: "rewrite", raises: [5], shuffleSeed: 16 },
  { id: "bryn", name: "Bryn", house: "tornmargin", renown: 20, matches: 14, profile: "Cautious", deckId: "fang", raises: [3], shuffleSeed: 17 },
];

export const GHOSTS: (GhostRecord & { id: string })[] = SEEDS.map((s) => ({
  id: s.id,
  name: s.name,
  house: s.house,
  renown: s.renown,
  matches: s.matches,
  profile: s.profile,
  deck: [...starter(s.deckId).cards],
  shuffleSeed: s.shuffleSeed,
  plays: null,
  raises: s.raises,
}));

export function ghostById(id: string): GhostRecord & { id: string } {
  return GHOSTS.find((g) => g.id === id) ?? GHOSTS[0]!;
}

export function pickGhost(matchesPlayed: number, renown: number, salt: number): GhostRecord & { id: string } {
  let pool = GHOSTS.filter((g) => g.house !== "tidewrack");
  if (matchesPlayed < 10) pool = pool.filter((g) => g.matches < 10);
  else {
    const band = pool.filter((g) => g.renown >= renown * 0.6 && g.renown <= renown * 1.4);
    if (band.length) pool = band;
  }
  return pool[salt % pool.length] ?? pool[0]!;
}
