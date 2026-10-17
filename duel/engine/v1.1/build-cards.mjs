import { CARDS, PAGES, LEGENDS, STARTERS } from './cards-src.mjs';
import { validateDeck } from './engine.mjs';
import fs from 'fs';
const bad = CARDS.filter((c) => c.text.length > 72); if (bad.length) { console.log('TOO LONG', bad.map((c) => c.id + ':' + c.text.length)); }
for (const h in STARTERS) { const e = validateDeck(h, STARTERS[h]); if (e) throw new Error(h + ' ' + e); }
const pool = CARDS.filter((c) => !c.champion && !c.token); const cnt = {}; for (const c of pool) cnt[c.house] = (cnt[c.house] || 0) + 1; console.log(cnt);
fs.writeFileSync('../cards-proto-v1.1.json', JSON.stringify({ version: 'cards-proto-1.1', engine: 'duel-engine-1.1.0', pages: PAGES, legends: LEGENDS, cards: CARDS, starters: STARTERS }, null, 1));
