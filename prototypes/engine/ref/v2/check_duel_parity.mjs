// Replay-log parity: Python duel_v2.duel vs this JS port. Zero mismatches required.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { duel } from "./duel_v2.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const N = Number(process.argv[2] || 400);
const out = "/tmp/bard-duel-parity.json";
const py = spawnSync("python3", ["-c", PY(N, root, out)], { encoding: "utf8" });
if (py.status !== 0) {
  console.error(py.stdout);
  console.error(py.stderr);
  process.exit(1);
}
process.stdout.write(py.stdout);
const data = JSON.parse(fs.readFileSync(path.join(root, "engine/duel-b-v2.json"), "utf8"));
const rows = JSON.parse(fs.readFileSync(out, "utf8"));
const canon = (v) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k2) => [k2, x[k2]]))
      : x,
  );
let bad = 0;
let first = null;
for (const row of rows) {
  const r = duel(row.a, row.b, row.s, data);
  const same =
    r.winner === row.winner &&
    r.why === row.why &&
    canon(r.log) === canon(row.log) &&
    canon(r.totA) === canon(row.totA) &&
    canon(r.locs) === canon(row.locs);
  if (!same) {
    bad += 1;
    if (!first) {
      let i = 0;
      while (i < Math.min(r.log.length, row.log.length) && canon(r.log[i]) === canon(row.log[i])) i += 1;
      first = { i, js: r.log[i], py: row.log[i], winner: [r.winner, row.winner] };
    }
  }
}
console.log(`${rows.length} duel replays, mismatches: ${bad}`);
if (first) console.log("first diff", JSON.stringify(first));
process.exit(bad ? 1 : 0);

function PY(n, root, dest) {
  return `
import json, random, sys
sys.path.insert(0, ${JSON.stringify(root + "/engine/ref/v2/duel")})
sys.path.insert(0, ${JSON.stringify(root + "/engine/ref/v2")})
from duel_v2 import duel
DATA=json.load(open(${JSON.stringify(root + "/engine/duel-b-v2.json")}))
ids=[c["id"] for c in DATA["cards"]]
rng=random.Random(7)
out=[]
def deck():
    d=ids[:]; rng.shuffle(d); return d[:12]
def plays():
    ps=[]
    for t in range(6):
        turn=[]
        for _ in range(rng.randint(0, 3)):
            turn.append([rng.choice(ids), rng.randint(0, 2)])
        ps.append(turn)
    return ps
for _ in range(${n}):
    recA={"deck": deck(), "plays": plays()}
    recB={"deck": deck(), "plays": plays()}
    seed=rng.getrandbits(32)
    r=duel(recA, recB, seed, DATA)
    out.append({"a": recA, "b": recB, "s": seed, "winner": r["winner"], "why": r["why"], "log": r["log"], "totA": r["totA"], "totB": r["totB"], "locs": r["locs"]})
json.dump(out, open(${JSON.stringify(dest)}, "w"))
print(${JSON.stringify(`${n} python replays written`)})
`;
}
