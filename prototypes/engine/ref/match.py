"""Match flow reference: shop, coins, merge, sell, survivors, rival snapshots. Spec: ../resolver-spec.md §9."""
from resolver import Mulberry32, derive_seed, resolve

COINS = {1: 3, 2: 5, 3: 7}
SHOP_SIZE = 5
REROLL_COST = 1
TIER_WEIGHTS = {1: [(1, 60), (2, 40)],
                2: [(1, 35), (2, 35), (3, 30)],
                3: [(1, 15), (2, 20), (3, 25), (4, 25), (5, 15)]}
ECHO_SLOTS = 2    # the first N cards of every roll are copies of units already on your line (if eligible)

SELL_VALUE = 1      # flat, matches Design layout.md §7 Q4
TUTORIAL_FREE_REROLLS = 1   # tutorial match only

def sell_value(copies):
    return SELL_VALUE

class Shop:
    def __init__(self, units, match_seed, rnd):
        self.units = units
        self.by_tier = {}
        for d in units["units"]:
            self.by_tier.setdefault(d["tier"], []).append(d["id"])
        self.rnd = rnd
        self.rng = Mulberry32(derive_seed(match_seed, 100 + rnd))
        self.cards = []

    def roll(self, line):
        """line: list of {"id","copies"}. Returns 5 unit ids (None = bought slot)."""
        maxtier = max(t for t, _ in TIER_WEIGHTS[self.rnd])
        merged = {u["id"] for u in line if u["copies"] >= 3}
        tiers = {d["id"]: d["tier"] for d in self.units["units"]}
        cards = []
        owned = [u["id"] for u in line if u["copies"] < 3 and tiers[u["id"]] <= maxtier]
        for _ in range(ECHO_SLOTS if owned else 0):
            cards.append(owned[self.rng.below(len(owned))])
        while len(cards) < SHOP_SIZE:
            r = self.rng.below(100); acc = 0; tier = TIER_WEIGHTS[self.rnd][-1][0]
            for t, w in TIER_WEIGHTS[self.rnd]:
                acc += w
                if r < acc: tier = t; break
            pool = [i for i in self.by_tier[tier] if i not in merged] or [i for i in self.by_tier[1] if i not in merged]
            cards.append(pool[self.rng.below(len(pool))])
        self.cards = cards
        return cards

def apply_buy(line, uid):
    """Stack onto an owned copy if present, else append. Returns True if bought."""
    for u in line:
        if u["id"] == uid:
            if u["copies"] >= 3: return False
            u["copies"] += 1
            return True
    if len(line) >= 5: return False
    line.append({"id": uid, "copies": 1})
    return True

def rival_line(snaps, rnd):
    """Opponent for round rnd = the rival's stored pre-fight line from the same round.
    A rival whose match ended 2-0 / 0-2 has no round-3 line: use its latest stored line."""
    return snaps[min(rnd, len(snaps)) - 1]

def play_round(line, rival_line, match_seed, rnd, units):
    res = resolve(line, rival_line, derive_seed(match_seed, rnd), units)
    surv = set(res["stats"]["survivorsA"])
    survivors = [dict(u) for i, u in enumerate(line) if f"A{i}" in surv]
    return res, survivors

def match_over(round_winners):
    """Best of 3: ends as soon as a side has 2 round wins. Draw rounds score for neither."""
    return round_winners.count("A") >= 2 or round_winners.count("B") >= 2 or len(round_winners) >= 3

def match_result(round_winners, r3_hp=None, match_seed=0):
    """round_winners: 'A'/'B'/'draw' per round played (A = live player). r3_hp = (hpA, hpB) surviving health
    at the end of the round-3 fight. Level after round 3 -> more surviving health wins -> then the seed. Never a draw."""
    a = round_winners.count("A"); b = round_winners.count("B")
    if a != b: return "win" if a > b else "loss"
    if r3_hp is not None and r3_hp[0] != r3_hp[1]:
        return "win" if r3_hp[0] > r3_hp[1] else "loss"
    return "win" if derive_seed(match_seed, 999) % 2 == 0 else "loss"
