import { Mulberry32 } from "../../engine/ref/resolver.mjs";
import { PLAYER_HOUSE } from "../config";
import type { HouseId } from "../houses";
import type { Piece } from "./sheet";

export interface StoredRun {
  id: string;
  name: string;
  house: HouseId;
  renown: number;
  matches: number;
  /** Pre-fight line for rounds 1, 2 and 3. Round 3 is required. */
  snaps: [Piece[], Piece[], Piece[]];
}

const p = (id: string, copies = 1): Piece => ({ id, copies });

/** Every stored run has all three rounds. A round-2 line is never reused as round 3. */
export const STORED_RUNS: StoredRun[] = [
  {
    id: "ferris",
    name: "Ferris",
    house: "pit",
    renown: 9,
    matches: 4,
    snaps: [
      [p("sump_brawler"), p("hunter"), p("deckhand")],
      [p("sump_brawler", 2), p("grenna"), p("hunter"), p("drummer")],
      [p("sump_brawler", 3), p("grenna", 2), p("kesh"), p("hunter", 2), p("drummer")],
    ],
  },
  {
    id: "nessa",
    name: "Nessa",
    house: "candle",
    renown: 6,
    matches: 2,
    snaps: [
      [p("novice"), p("wren"), p("portrait")],
      [p("novice", 2), p("wren"), p("wick"), p("portrait")],
      [p("novice", 3), p("wren", 2), p("wick"), p("marrow"), p("pip")],
    ],
  },
  {
    id: "bram",
    name: "Bram",
    house: "fold",
    renown: 11,
    matches: 7,
    snaps: [
      [p("duellist"), p("corvin"), p("blotling")],
      [p("duellist", 2), p("corvin"), p("ash_ember"), p("doodle")],
      [p("duellist", 3), p("corvin", 2), p("ash_ember"), p("colophon"), p("doodle")],
    ],
  },
  {
    id: "ioe",
    name: "Ioe",
    house: "scriptorium",
    renown: 8,
    matches: 3,
    snaps: [
      [p("copyist"), p("footnote"), p("novice")],
      [p("copyist", 2), p("index"), p("footnote"), p("silas")],
      [p("copyist", 3), p("index", 2), p("silas"), p("footnote", 2), p("hob")],
    ],
  },
  {
    id: "quill",
    name: "Quill",
    house: "standard",
    renown: 40,
    matches: 28,
    snaps: [
      [p("drummer"), p("footnote"), p("deckhand")],
      [p("drummer", 2), p("vey"), p("footnote", 2), p("grenna")],
      [p("drummer", 3), p("vey", 2), p("errata"), p("footnote", 3), p("hob")],
    ],
  },
  {
    id: "marta",
    name: "Marta",
    house: "gilt",
    renown: 55,
    matches: 36,
    snaps: [
      [p("portrait"), p("croak"), p("novice")],
      [p("portrait", 2), p("croak"), p("marrow"), p("wick")],
      [p("portrait", 3), p("croak", 2), p("marrow"), p("colophon"), p("reader")],
    ],
  },
  {
    id: "oss",
    name: "Oss",
    house: "tornmargin",
    renown: 22,
    matches: 16,
    snaps: [
      [p("hunter"), p("grub"), p("thorn")],
      [p("hunter", 2), p("grub"), p("thorn"), p("wolf")],
      [p("hunter", 3), p("grub", 2), p("thorn", 2), p("wolf"), p("weeping")],
    ],
  },
  {
    id: "vesper",
    name: "Vesper",
    house: "pit",
    renown: 70,
    matches: 52,
    snaps: [
      [p("sump_brawler", 2), p("kesh"), p("grenna")],
      [p("sump_brawler", 3), p("kesh"), p("grenna", 2), p("errata")],
      [p("kesh", 3), p("grenna", 3), p("errata"), p("colophon"), p("hob", 2)],
    ],
  },
];

export function runById(id: string): StoredRun {
  const run = STORED_RUNS.find((r) => r.id === id);
  if (!run) throw new Error(id);
  return run;
}

export interface Seeker {
  renown: number;
  matchesPlayed: number;
}

/** Cocoon for the first 10 real matches: stored runs under 10 matches, rival House only. */
export function pickRival(seeker: Seeker, seed: number, forceId?: string): StoredRun {
  if (forceId) return runById(forceId);
  const rival = STORED_RUNS.filter((r) => r.house !== PLAYER_HOUSE && r.snaps.length === 3);
  let pool = rival;
  if (seeker.matchesPlayed < 10) {
    pool = rival.filter((r) => r.matches < 10);
  } else {
    const lo = seeker.renown * 0.6;
    const hi = seeker.renown * 1.4;
    const band = rival.filter((r) => r.renown >= lo && r.renown <= hi);
    pool = band.length ? band : rival;
  }
  if (!pool.length) pool = rival;
  const rng = new Mulberry32(seed >>> 0);
  return pool[rng.below(pool.length)]!;
}
