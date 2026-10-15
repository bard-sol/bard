/** Automatic last-words filter, then the review hook. No human review in Season 0. */

const SLURS = [
  'nigger', 'nigga', 'faggot', 'fag', 'tranny', 'retard', 'kike', 'spic', 'chink', 'wetback'
];

const SEXUAL = ['porn', 'nude', 'xxx', 'nsfw'];

export function graphemeLength(text) {
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return [...seg.segment(String(text || ''))].length;
}

export function filterLastWords(text) {
  const raw = String(text || '');
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'empty', category: 'spam' };
  if (graphemeLength(trimmed) > 140) return { ok: false, reason: 'Over 140 characters.', category: 'spam' };
  if (/https?:\/\/|www\./i.test(trimmed) || /\b[a-z0-9-]+\.(com|net|org|io|xyz|gg|fun|sol|app|dev|co|is)\b/i.test(trimmed)) {
    return { ok: false, reason: "Removed: links aren't allowed.", category: 'links' };
  }
  if (/[1-9A-HJ-NP-Za-km-z]{32,44}/.test(trimmed)) {
    return { ok: false, reason: 'Removed: wallet addresses aren\'t allowed.', category: 'address' };
  }
  if (/\$[A-Z]{2,10}\b/.test(trimmed)) {
    return { ok: false, reason: "Removed: token tickers aren't allowed.", category: 'ticker' };
  }
  if (/(^|\s)@[A-Za-z0-9_]{2,15}\b/.test(trimmed)) {
    return { ok: false, reason: "Removed: handles aren't allowed.", category: 'handle' };
  }
  const lower = trimmed.toLowerCase();
  for (const word of SLURS) {
    if (lower.includes(word)) return { ok: false, reason: "Removed: that language isn't allowed.", category: 'slur' };
  }
  return { ok: true, text: trimmed, graphemes: graphemeLength(trimmed) };
}

/**
 * Review hook. Runs on the squad's winning line after the filter.
 * Returns a category the author can see. There is no appeal in Season 0.
 */
export function reviewLastWords(text) {
  const filtered = filterLastWords(text);
  if (!filtered.ok) {
    const map = {
      slur: 'Hate or slurs',
      links: 'Links, addresses, tickers or shilling',
      address: 'Links, addresses, tickers or shilling',
      ticker: 'Links, addresses, tickers or shilling',
      handle: 'Links, addresses, tickers or shilling',
      empty: 'Spam',
      spam: 'Spam'
    };
    return { ok: false, category: map[filtered.category] || 'Spam' };
  }
  const line = filtered.text;
  const lower = line.toLowerCase();
  if (SLURS.some((w) => lower.includes(w))) return { ok: false, category: 'Hate or slurs' };
  if (/\b(kill you|i will find you|i'?ll find you|dox you|you should die)\b/i.test(line)) {
    return { ok: false, category: 'Harassment or threats' };
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(line) || /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(line) || /\blives at\b/i.test(line)) {
    return { ok: false, category: 'Personal info / doxxing' };
  }
  if (SEXUAL.some((w) => lower.includes(w))) return { ok: false, category: 'Sexual content' };
  if (/\b(i am bard|official team|send it to|buy my)\b/i.test(line)) {
    return { ok: false, category: 'Impersonation' };
  }
  if (/(.)\1{7,}/.test(line)) return { ok: false, category: 'Spam' };
  return { ok: true };
}

/** Squad upvote. Most votes, then earliest submission. A single line wins. */
export function chooseLastWords(submissions) {
  const list = (submissions || []).filter((s) => s && s.text);
  if (!list.length) return { winner: null, reason: 'none' };
  const sorted = [...list].sort((a, b) => {
    const dv = (b.votes || 0) - (a.votes || 0);
    if (dv) return dv;
    return (a.submittedAt || 0) - (b.submittedAt || 0);
  });
  return { winner: sorted[0], reason: 'votes' };
}

export function resolveLastWords({ submissions, fallback }) {
  const choice = chooseLastWords(submissions);
  if (!choice.winner) {
    return { line: fallback, source: 'fallback', category: null };
  }
  const review = reviewLastWords(choice.winner.text);
  if (!review.ok) {
    return { line: fallback, source: 'fallback', category: review.category, rejected: choice.winner };
  }
  return { line: choice.winner.text, source: 'squad', category: null, author: choice.winner.wallet };
}
