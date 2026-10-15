import { pickIndex, mixSeed } from "./rng";

/** Story team, bard-narration-v1. Seeded per match so a replay shows the same line. */
export const NARRATION = {
  shop: [
    "The shop's open. Choose who stands in your line tonight.",
    "Five faces, a little time. Pick the ones you'd want beside you.",
    "Fresh pages on the counter. Read them carefully before you choose.",
    "Three of a kind become something new. I do love a good merge.",
    "Order matters as much as names. Who leads? Who waits?",
    "Take your time. The fight doesn't start until you say so.",
    "Somebody here will surprise you. Somebody always does.",
    "New figures on the shelf, darling. Some of them have never been chosen.",
    "Build a line you'd be proud to see written down.",
    "The page is waiting. Fill it.",
  ],
  fight: [
    "Lines drawn. Let's see what the page makes of them.",
    "{rival_house} has sent its best line. So have you.",
    "No more choices now. Only watching.",
    "Front to back, turn by turn. I'll write down every blow.",
    "Somebody has to hold the front. Let's find out who.",
    "Every line looks brave before the first hit.",
    "The ink is wet. Here we go.",
    "Both sides believe they've read this ending. Neither has.",
    "Watch the triggers. That's where the story hides.",
    "Fight. I'll be taking notes.",
  ],
  win: [
    "Your line held. I've written it down exactly as it happened.",
    "A win. Your House will feel that one.",
    "Well read, darling. Every placement mattered.",
    "They fought well. You fought a little better.",
    "That's one for the Chronicle.",
    "The last figure standing was yours. Remember who it was.",
    "A clean page. Shall we write another?",
    "{rival_house} will remember this line. So will I.",
    "You chose well. The page agreed.",
    "Victory looks good in ink. Again?",
  ],
  loss: [
    "Not this time. Now you know how they think.",
    "A loss is a lesson with the answers left in.",
    "They held. Next line, different order?",
    "I've written it down kindly. Try again.",
    "Every House loses sometimes. Every House gets up and writes the next line.",
    "That line taught you something. Use it.",
    "Close. Closer than it looked.",
    "I'm fond of the ones who lose, darling. Go again.",
    "One page lost. The Book has plenty more.",
    "Shuffle the line and turn the page.",
  ],
  draw: [
    "Both lines fell together. Even I didn't see that coming.",
    "A draw. The page refuses to choose.",
    "Nobody's left standing, and everybody fought.",
    "Two lines, one ending. I'll write them side by side.",
    "Perfectly even. That almost never happens.",
    "Neither House gave an inch. I'll note that.",
    "A tie. Somewhere, the Fold is very pleased with itself.",
    "The ink ran out on both sides at once.",
    "Undecided. My favourite kind of page, nearly.",
    "A draw. Rebuild, and break the tie.",
  ],
} as const;

export type NarrationMoment = keyof typeof NARRATION;

const SALT: Record<NarrationMoment, number> = { shop: 11, fight: 23, win: 37, loss: 41, draw: 53 };

export function pickNarration(
  moment: NarrationMoment,
  seed: number,
  ctx: { rivalHouse?: string; player?: string } = {},
): string {
  const pool = NARRATION[moment];
  const line = pool[pickIndex(pool.length, mixSeed(seed, SALT[moment]))] ?? pool[0];
  return line
    .replaceAll("{rival_house}", ctx.rivalHouse ?? "They")
    .replaceAll("{player}", ctx.player ?? "you");
}
