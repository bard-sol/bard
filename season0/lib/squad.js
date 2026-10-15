/** Lowest-numbered open squad. Published and deterministic given join order. */
export function assignSquad(squads, wallet, size) {
  const cap = size || 25;
  const list = squads || [];
  const open = list
    .filter((s) => (s.members || []).length < cap && !(s.members || []).includes(wallet))
    .sort((a, b) => a.number - b.number);
  if (open.length) {
    open[0].members.push(wallet);
    return open[0];
  }
  const number = list.reduce((m, s) => Math.max(m, s.number), 0) + 1;
  const created = { number, members: [wallet] };
  list.push(created);
  return created;
}

export function squadScore(members) {
  const list = members || [];
  const n = list.length;
  const active = list.filter((m) => m.active).length;
  const accuracies = list.map((m) => m.strikeAccuracy).filter((x) => Number.isFinite(x));
  const meanAcc = accuracies.length ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : 0;
  const trained = list.reduce((a, m) => a + (Number(m.trained) || 0), 0);
  return {
    activeRate: n ? active / n : 0,
    meanStrike: meanAcc,
    trained,
    members: n
  };
}

export function rankSquads(squads, minMembers) {
  const min = minMembers == null ? 5 : minMembers;
  return (squads || [])
    .filter((s) => (s.members || []).length >= min)
    .map((s) => ({ squad: s, score: squadScore(s.members) }))
    .sort((a, b) => {
      if (a.score.activeRate !== b.score.activeRate) return b.score.activeRate - a.score.activeRate;
      if (a.score.meanStrike !== b.score.meanStrike) return b.score.meanStrike - a.score.meanStrike;
      if (a.score.trained !== b.score.trained) return b.score.trained - a.score.trained;
      return a.squad.number - b.squad.number;
    });
}

/** Two consecutive ineligible snapshots remove the wallet. A voided chapter does not count. */
export function removalAfterSnapshot({ consecutiveIneligible, eligibleNow, chapterVoided }) {
  if (chapterVoided) return { consecutive: consecutiveIneligible || 0, removed: false };
  const next = eligibleNow ? 0 : (consecutiveIneligible || 0) + 1;
  return { consecutive: next, removed: next >= 2 };
}

export function cosmeticWinner(options, votes) {
  const list = options || [];
  if (!list.length) return null;
  const tally = list.map((opt, index) => ({
    opt,
    index,
    votes: Number(votes && votes[opt.id]) || 0
  }));
  const top = Math.max(...tally.map((t) => t.votes));
  const tied = tally.filter((t) => t.votes === top).sort((a, b) => a.index - b.index);
  return { option: tied[0].opt, tie: tied.length > 1 && top > 0, noVotes: top === 0 };
}

/**
 * Handler rank: equal mix of this chapter's Strike power, Train credit,
 * and capped Decide weight. Ties go to the earliest action.
 */
export function handlerRanks(rows) {
  const list = rows || [];
  const maxS = Math.max(0, ...list.map((r) => Number(r.strikePower) || 0));
  const maxT = Math.max(0, ...list.map((r) => Number(r.train) || 0));
  const maxD = Math.max(0, ...list.map((r) => Number(r.decideWeight) || 0));
  const norm = (v, m) => (m > 0 ? (Number(v) || 0) / m : 0);
  return list
    .map((r) => ({
      ...r,
      score: norm(r.strikePower, maxS) + norm(r.train, maxT) + norm(r.decideWeight, maxD)
    }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return (a.earliest || 0) - (b.earliest || 0);
    })
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
