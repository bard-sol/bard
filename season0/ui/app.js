import { CAST, characterById } from '../lib/cast.js';
import { CHAPTERS } from '../lib/chapters.js';
import { graphemeLength } from '../lib/filter.js';
import { defaultConfig } from '../lib/config.js';
import { earlyBuyCopy } from '../lib/legacy.js';
import { replayTrial } from '../lib/trial.js';
import { QUIZ } from '../lib/quiz.js';
import { paintTrial } from './trial-view.js';
import { heroSrc } from './portraits.js';
import {
  ELIGIBILITY_NOTE,
  PREDICT_NOTE,
  RELIC_NOTE,
  bannerStack,
  headerCopy,
  screenState,
  standings,
  voidCardLine
} from './view.js';
import { bustSvg } from './portraits.js';
import { looksLikeMainnet, phantomBrowseUrl, solflareBrowseUrl, wrongNetworkHelp } from './wallet.js';

const params = new URLSearchParams(location.search);
const anchor = Date.now();
const store = loadStore();

const ui = {
  tab: params.get('tab') || 'arena',
  wallet: store.wallet || null,
  walletState: store.wallet ? 'signed-in' : 'signed-out',
  config: defaultConfig(),
  publicInfo: { pools: {} },
  sheet: null,
  trial: null,
  trialPaint: null,
  quizAnswers: [],
  quizResult: null,
  loopNote: '',
  train: { amount: 100, holdUntil: 0, state: 'ready' },
  decideChoice: null,
  draft: '',
  wordsState: 'compose',
  wordsResult: null,
  pick: store.pick || null,
  cheer: store.cheer || null,
  revivalPaid: store.revivalPaid || 0,
  eligibility: null,
  toast: '',
  walletKind: store.walletKind || null,
  wrongNetwork: params.get('wrong-network'),
  backed: store.backed || 'pip',
  chest: null
};

function loadStore() {
  try { return JSON.parse(localStorage.getItem('bard-s0') || '{}'); }
  catch { return {}; }
}

function saveStore() {
  localStorage.setItem('bard-s0', JSON.stringify({
    wallet: ui.wallet,
    walletKind: ui.walletKind,
    pick: ui.pick,
    cheer: ui.cheer,
    revivalPaid: ui.revivalPaid,
    train: store.train || {},
    backed: ui.backed
  }));
}

function nowMs() {
  if (!params.get('phase')) return Date.now();
  params.set('elapsed', String(Date.now() - anchor));
  return Date.now();
}

function screen() {
  const q = new URLSearchParams(params);
  if (params.get('phase')) q.set('elapsed', String(Date.now() - anchor));
  return screenState({
    config: ui.config,
    now: Date.now(),
    query: q,
    standingsRows: standings(store.train || {})
  });
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  return res.json();
}

function toast(text) {
  ui.toast = text;
  const el = document.getElementById('toast');
  el.hidden = !text;
  el.textContent = text;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { ui.toast = ''; el.hidden = true; }, 4200);
}

function shortWallet(key) {
  if (!key) return 'Sign in';
  if (key === 'demo') return 'Demo · DEVNET';
  return key.slice(0, 4) + '…' + key.slice(-4) + ' · DEVNET';
}

function cardClass(row, s) {
  const classes = ['card'];
  if (row.id === s.relicId) classes.push('relic');
  else if (s.marked === row.id && s.phase === 'P6') classes.push('marked');
  else if (s.marked === row.id && s.revivalOpen) classes.push('marked');
  else if (s.danger.includes(row.id)) classes.push('danger');
  return classes.join(' ');
}

function chipsFor(row, s) {
  const chips = [];
  if (s.voided) chips.push('NOT FINAL');
  else if (s.marked === row.id && s.revivalOpen) chips.push('REVIVAL OPEN');
  else if (s.marked === row.id) chips.push('MARKED');
  else if (s.danger.includes(row.id)) chips.push('IN DANGER');
  return chips.map((c) => '<span class="chip">' + c + '</span>').join('');
}

function statBars(character, trained) {
  const max = { STR: 75, CUN: 80, CHA: 80, LCK: 80 };
  return ['STR', 'CUN', 'CHA', 'LCK'].map((key) => {
    const base = character.stats[key];
    const width = Math.min(100, ((base + trained) / (max[key] + 40)) * 100);
    return '<span class="stat" title="' + key + ' ' + base + ' + ' + trained + '"><i style="width:' + width + '%;background:' + character.color + '"></i></span>';
  }).join('');
}

function renderHeader(s) {
  const copy = headerCopy(s);
  const hatch = copy.hatch ? ' hatch' : '';
  const segs = [0, 1, 2, 3].map((i) => {
    const on = (s.phase === 'P1' && i === 0) || (s.phase === 'P2' && i <= 1) || (s.phase === 'P3' && i <= 2) || (s.phase === 'P4' && i <= 3);
    const hat = s.phase === 'P4' && i === 3 ? ' hatch' : '';
    return '<span class="' + (on ? 'on' : '') + hat + (s.voided ? ' hatch' : '') + '"></span>';
  }).join('');
  document.getElementById('top').innerHTML =
    '<div class="head-row">' +
    '<img class="mark" src="/transparentbardsmile.png" alt="">' +
    '<span class="kicker">Bard · S0 · Ch ' + esc(s.chapter) + '/7</span>' +
    '<span class="badge">DEVNET</span>' +
    (s.chapterNight ? '<a class="live" href="/play/night/' + s.chapter + '">LIVE</a>' : '') +
    '<button class="wallet" type="button" data-act="signin" data-wallet="' + (ui.wrongNetwork ? 'wrong-network' : (ui.wallet ? 'signed-in' : 'signed-out')) + '">' + esc(ui.wrongNetwork ? 'Wrong network' : shortWallet(ui.wallet)) + '</button>' +
    '</div>' +
    '<div class="phasebar' + hatch + '" aria-hidden="true">' + segs + '</div>' +
    (s.travel ? '<p class="travel">Time travel · ' + esc(s.phase) + ' · not the live clock</p>' : '') +
    '<p class="headline" data-clock="headline">' + esc(copy.title) + '</p>' +
    '<p class="footnote" data-clock="footnote">' + esc(copy.footnote) + '</p>' +
    wrongNetworkBanner();
}

function wrongNetworkBanner() {
  if (!ui.wrongNetwork) return '';
  const help = wrongNetworkHelp(ui.wrongNetwork === '1' ? (ui.walletKind || 'other') : ui.wrongNetwork);
  return '<p class="banner wrong" data-banner="wrong-network"><strong>' + esc(help.title) + '</strong> ' + esc(help.steps) + '</p>';
}

function renderBanners(s) {
  const stack = bannerStack(s);
  const html = stack.visible.map((b) =>
    '<section class="banner ' + b.tone + '" data-banner="' + b.id + '"><strong>' + esc(b.title) + '</strong><p>' + esc(b.body) + '</p>' +
    (b.id === 'void' ? '<button class="btn" type="button" data-act="open" data-sheet="verify">See the record</button>' : '') +
    (b.id === 'revival' ? '<button class="btn solid" type="button" data-act="open" data-sheet="revive" data-char="' + esc(s.marked) + '">Burn tBard</button>' : '') +
    (b.id === 'night' ? '<a class="btn" href="/play/night/' + s.chapter + '">Watch</a>' : '') +
    '</section>'
  ).join('');
  const more = stack.extra ? '<p class="meta">+' + stack.extra + ' more</p>' : '';
  return html + more;
}

function renderCards(s) {
  const ordered = [...s.rows].sort((a, b) => {
    const ar = a.id === s.relicId ? 1 : 0;
    const br = b.id === s.relicId ? 1 : 0;
    return ar - br || a.rank - b.rank;
  });
  return ordered.map((row) => {
    const c = row.character;
    const gap = row.gap == null ? '—' : (row.gap * 100).toFixed(1) + '%';
    const gapClass = row.lowest ? 'warn' : '';
    const scoreNote = s.voided ? 'Not final: chapter voided' : row.S.toFixed(3);
    const relic = row.id === s.relicId;
    const relicChapter = params.get('relicChapter') || '2';
    const art = relic ? 'relic' : (s.danger.includes(row.id) ? 'danger' : 'alive');
    return '<button class="' + cardClass(row, s) + '" type="button" data-act="open" data-sheet="detail" data-char="' + c.id + '">' +
      bustSvg(c, 64, art) +
      '<span><span class="scoreline"><span>' + esc(c.name) + ' <span class="meta">' + esc(c.archetype) + '</span></span>' +
      '<b class="num">#' + row.rank + ' ' + scoreNote + '</b></span>' +
      '<span class="stats">' + statBars(c, row.trained) + '</span>' +
      '<span class="meta">turnout ' + (row.turnout * 100).toFixed(0) + '% · ' + row.handlers + ' handlers · <span class="' + gapClass + '">gap ' + gap + '</span></span>' +
      (relic ? '<span class="chip">RELIC · inked out in Chapter ' + esc(relicChapter) + '</span><span class="meta">' + esc(RELIC_NOTE) + '</span>' : '') +
      (s.voided ? '<span class="meta" data-void-card>' + esc(voidCardLine(s.voidReason)) + '</span>' : '') +
      '<span class="chips">' + chipsFor(row, s) + '</span></span></button>';
  }).join('');
}

function renderCastStrip(s) {
  return '<div class="pagecast"><p class="kicker">The page</p><div class="faces">' + CAST.map((c) => {
    const relic = c.id === s.relicId;
    const danger = s.danger.includes(c.id);
    const state = relic ? 'relic' : danger ? 'danger' : 'alive';
    const mine = c.id === ui.backed ? ' mine' : '';
    return '<button class="face' + mine + (danger ? ' danger' : '') + (relic ? ' dead' : '') + '" type="button" data-act="back" data-char="' + c.id + '">' +
      bustSvg(c, 40, state) + '<span>' + esc(c.name.split(' ')[0]) + '</span></button>';
  }).join('') + '</div></div>';
}

function renderArena(s) {
  const pot = 'Test pot · no payout in Season 0';
  const backed = characterById(ui.backed) || CAST[3];
  return renderBanners(s) +
    '<p class="row"><span class="chip">' + pot + '</span><span class="chip">Contributor pool · tBard only</span></p>' +
    '<div class="bardstrip"><img src="/play/assets/avatars/bard.webp" alt="Bard"><p class="voice">' + esc(s.chapterText ? s.chapterText.bard : '') + '</p></div>' +
    renderCastStrip(s) +
    '<article class="hero-card"><img src="' + heroSrc(backed.id, 'alive') + '" alt="' + esc(backed.name) + '">' +
    '<div><p class="kicker">Your character</p><h2>' + esc(backed.name) + '</h2><p class="meta">' + esc(backed.archetype) + '</p>' +
    '<button class="btn solid" type="button" data-act="open" data-sheet="trial" data-char="' + backed.id + '">Play today\'s Trial</button></div></article>' +
    '<div class="cards">' + renderCards(s) + '</div>' +
    '<p class="formula">Survival score S = 0.30·M + 0.30·U + 0.15·B + 0.15·P + 0.10·K · <button class="btn" type="button" data-act="open" data-sheet="verify">Verify</button></p>';
}

function renderPlay(s) {
  const locked = s.voided ? '<p class="banner info">Chapter voided: the daily Trial has no score effect. Your Train credit is kept.</p>' : '';
  const letter = '<section data-loop="letter"><h2 class="kicker">Morning letter</h2>' +
    '<p>One tap. Feed, Comfort, or Spar. A free chest follows. It is not an NFT.</p>' +
    '<div class="row">' +
    '<button class="btn solid" type="button" data-act="letter" data-choice="feed">Feed</button>' +
    '<button class="btn" type="button" data-act="letter" data-choice="comfort">Comfort</button>' +
    '<button class="btn" type="button" data-act="letter" data-choice="spar">Spar</button>' +
    '</div>' +
    (ui.chest ? '<div class="chest-moment"><img src="/play/assets/props/chest.webp" alt="Daily chest"><p data-loop-note>' + esc(ui.loopNote) + '</p><p class="meta">Common 70% · Rare 25% · Epic 5%. A rare is guaranteed within 10 days. Yours, not an NFT.</p></div>' : (ui.loopNote ? '<p data-loop-note>' + esc(ui.loopNote) + '</p>' : '')) +
    '</section>';
  const trial = '<section data-loop="trial"><h2 class="kicker">Daily Trial</h2>' +
    '<p>One counted run per UTC day. Same boss for everyone. Practice does not count. K is the average of those days, and a missed day is 0.</p>' +
    '<button class="btn solid" type="button" data-act="open" data-sheet="trial" data-loop="trial">Trial</button>' +
    '</section>';
  const extras = '<div class="row">' +
    '<button class="btn" type="button" data-act="open" data-sheet="crowd">Crowd vote</button>' +
    '<button class="btn" type="button" data-act="open" data-sheet="recap">Recap</button>' +
    '<button class="btn" type="button" data-act="push-on">Notifications</button>' +
    '<button class="btn" type="button" data-act="open" data-sheet="quiz">Quiz</button>' +
    '<button class="btn" type="button" data-act="open" data-sheet="story">Story</button>' +
    '<button class="btn" type="button" data-act="chest-odds">Chest odds</button>' +
    '</div>';
  const list = CAST.map((c) => {
    const relic = c.id === s.relicId;
    const dead = s.marked === c.id && (s.phase === 'P6' || s.revivalOpen);
    return '<article class="banner"><strong>' + esc(c.name) + '</strong>' +
      '<div class="row">' +
      (relic || (dead && !s.revivalOpen) ? '<span class="meta">Train and Decide are closed.</span>' : '') +
      (!relic && !dead ? '<button class="btn" type="button" data-act="open" data-sheet="train" data-char="' + c.id + '">Train</button>' : '') +
      (!relic && !dead ? '<button class="btn" type="button" data-act="open" data-sheet="decide" data-char="' + c.id + '">Decide</button>' : '') +
      '<button class="btn" type="button" data-act="cheer" data-char="' + c.id + '">Cheer</button>' +
      (s.revivalOpen && s.marked === c.id ? '<button class="btn reaper" type="button" data-act="open" data-sheet="revive" data-char="' + c.id + '">Revive</button>' : '') +
      '</div></article>';
  }).join('');
  return locked + letter + trial + extras +
    '<p class="footnote">A streak advances on the letter, a Trial, a cheer, or a vote. Repair is never for sale. Cheering never counts as active.</p>' + list;
}

function renderPredict(s) {
  const locked = !s.picksOpen;
  const grid = CAST.filter((c) => c.id !== s.relicId && c.id !== s.marked).map((c) => {
    const on = ui.pick && ui.pick.charId === c.id && ui.pick.chapter === s.chapter ? ' on' : '';
    return '<button class="choice' + on + '" type="button" data-act="pick" data-char="' + c.id + '" ' + (locked ? 'disabled' : '') + '>' +
      c.glyph + ' ' + esc(c.name) + '</button>';
  }).join('');
  const mine = ui.pick && ui.pick.chapter === s.chapter ? '<p>Your pick: ' + esc(ui.pick.charId) + (ui.pick.counts ? ' · counted' : ' · not counted') + '</p>' : '';
  return '<p>' + esc(PREDICT_NOTE) + '</p>' +
    (s.voided ? '<p class="banner info" data-state="void">Chapter ' + s.chapter + ' voided. Your pick is void: no points, and it does not count toward your cap.</p>' : '') +
    (locked && !s.voided ? '<p class="banner">Locked at the shortlist. Result after the Reaper.</p>' : '') +
    '<p class="meta">Correct pick = 10 legacy points · season cap 50</p>' +
    mine + grid +
    '<p class="footnote">This tab does not show the shortlist while picks are open.</p>';
}

function renderSquad(s) {
  const marked = characterById(s.marked || 'thorn');
  const top = ui.wallet ? '<p class="chip">Top squad · Chapter ' + s.chapter + '</p>' : '<p>You will join a squad when you become eligible.</p>';
  const words = s.phase === 'P6' && s.marked
    ? '<button class="btn solid" type="button" data-act="open" data-sheet="words" data-char="' + s.marked + '">Last words for ' + esc(marked.name) + '</button>'
    : '<p class="meta">Last words open for the marked character\'s top squad.</p>';
  const cosmetic = marked.cosmetics.map((opt, i) =>
    '<button class="choice" type="button" data-act="cosmetic" data-id="' + opt.id + '">' + (i + 1) + '. ' + esc(opt.title) + '</button>'
  ).join('');
  return top +
    '<p>Ink Debt · ' + esc(marked.name) + ' · 19 / 25 active</p>' +
    '<p class="meta">Needs 5 members to compete. Active means a counted Trial, Train or Decide before the snapshot.</p>' +
    words +
    (s.voided ? '<p class="banner info">No top squad: chapter voided.</p>' : '') +
    '<h2 class="kicker">Cosmetic vote · 3 options · tie goes to the first</h2>' + cosmetic +
    '<p class="footnote">Comeback votes are off. Relic burns are off.</p>';
}

function renderMe(s) {
  const early = '<p>' + esc(earlyBuyCopy(s.config)) + '</p>' +
    '<p>Every source shares a cap of 50 for Season 1 early-buy rights. Points above the cap are cosmetic. They count only after a Turnstile check and one finalized on-chain action.</p>' +
    '<p>Contributor rewards are tBard only, unlocked in a straight line over 14 days after the finale. Season 0 has no mainnet payout.</p>' +
    '<p data-impact>' + esc(ui.impact || '') + '</p>' +
    '<button class="btn" type="button" data-act="impact">Your impact</button>' +
    '<button class="btn" type="button" data-act="legacy-check">Legacy standing</button>';
  const elig = ui.eligibility
    ? '<p data-elig="' + (ui.eligibility.eligible ? 'yes' : 'no') + '">' +
      (ui.eligibility.eligible ? 'Eligible ✓ · holding since the sample clock.' : 'Hold any amount for 24h · eligible in 4h 0m.') +
      ' Devnet minimum ' + ui.eligibility.eligibility_min_sol + ' SOL. Value shown ' + ui.eligibility.value_sol + ' does not gate Season 0.</p>'
    : '<p>Checking eligibility…</p>';
  return '<h2>Legacy</h2>' + early +
    '<h2>Eligibility</h2>' + elig +
    '<p class="footnote">' + esc(ELIGIBILITY_NOTE) + '</p>' +
    '<p class="meta">Hold any amount for 24h. A zero balance restarts the clock. Faucet tBard never confers eligibility.</p>' +
    '<h2>Faucet</h2>' +
    '<p>First sign-in: 1,000 tBard + 0.05 devnet SOL. Cheer: +100 tBard. Get devnet SOL: 0.5 per day.</p>' +
    '<div class="row"><button class="btn solid" type="button" data-act="faucet">Get devnet SOL</button>' +
    '<button class="btn" type="button" data-act="faucet-first">Claim first sign-in</button></div>' +
    '<h2>Relics</h2><p>' + esc(RELIC_NOTE) + '</p>' +
    '<p class="meta">Wallet ' + esc(ui.wallet || 'signed out') + ' · app pinned to devnet.</p>';
}

function renderMain() {
  const s = screen();
  renderHeader(s);
  const panels = {
    arena: renderArena(s),
    play: renderPlay(s),
    predict: renderPredict(s),
    squad: renderSquad(s),
    me: renderMe(s)
  };
  document.getElementById('main').innerHTML = panels[ui.tab] || panels.arena;
  const tabs = ['arena', 'play', 'predict', 'squad', 'me'];
  const buttons = tabs.map((tab) =>
    '<button type="button" class="' + (ui.tab === tab ? 'on' : '') + '" data-act="tab" data-tab="' + tab + '">' + tab[0].toUpperCase() + tab.slice(1) + '</button>'
  ).join('');
  document.getElementById('tabs').innerHTML = buttons;
  document.getElementById('rail').innerHTML = buttons;
  document.body.dataset.phase = s.phase;
  document.body.dataset.voided = s.voided ? '1' : '0';
}

function openSheet(name, charId) {
  stopTrialPaint();
  ui.sheet = { name, charId: charId || (name === 'trial' ? ui.backed : (ui.sheet && ui.sheet.charId)) || 'pip' };
  if (name === 'trial') ui.trial = null;
  if (name === 'quiz') { ui.quizAnswers = []; ui.quizResult = null; }
  if (name === 'words') { ui.wordsState = 'compose'; ui.wordsResult = null; }
  renderSheet();
  if (name === 'trial') beginTrial(false);
  if (name === 'recap') loadRecap();
  if (name === 'story') loadStory(ui.sheet.charId);
}

function stopTrialPaint() {
  if (ui.trial && ui.trial.clock) clearInterval(ui.trial.clock);
  if (ui.trialPaint) {
    ui.trialPaint.destroy();
    ui.trialPaint = null;
  }
}

function closeSheet() {
  stopTrialPaint();
  ui.sheet = null;
  ui.trial = null;
  document.getElementById('sheet').innerHTML = '';
}

function sheetWrap(title, body) {
  document.getElementById('sheet').innerHTML =
    '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><article>' +
    '<div class="row"><strong>' + esc(title) + '</strong><button class="btn" type="button" data-act="close">Close</button></div>' +
    body + '</article></div>';
}

function renderSheet() {
  if (!ui.sheet) return;
  const s = screen();
  const c = characterById(ui.sheet.charId) || CAST[0];
  if (ui.sheet.name === 'detail') return sheetDetail(s, c);
  if (ui.sheet.name === 'trial') return sheetTrial(s, c);
  if (ui.sheet.name === 'crowd') return sheetCrowd();
  if (ui.sheet.name === 'recap') return sheetRecap(s);
  if (ui.sheet.name === 'quiz') return sheetQuiz();
  if (ui.sheet.name === 'story') return sheetStory(c);
  if (ui.sheet.name === 'train') return sheetTrain(s, c);
  if (ui.sheet.name === 'decide') return sheetDecide(s, c);
  if (ui.sheet.name === 'revive') return sheetRevive(s, c);
  if (ui.sheet.name === 'verify') return sheetVerify(s);
  if (ui.sheet.name === 'words') return sheetWords(s, c);
  if (ui.sheet.name === 'signin') return sheetSign();
}

function sheetDetail(s, c) {
  const row = s.rows.find((r) => r.id === c.id);
  const relic = c.id === s.relicId;
  sheetWrap(c.name, bustSvg(c, 96, relic ? 'relic' : 'alive') +
    '<p class="voice">' + esc(c.voice) + '</p><p>' + esc(c.hook) + '</p>' +
    '<p>Survival score ' + (row ? row.S.toFixed(3) : '') + ' · M ' + (row ? row.M.toFixed(2) : '') +
    ' · U ' + (row ? row.U.toFixed(2) : '') + ' · B ' + (row ? row.B.toFixed(2) : '') +
    ' · P ' + (row ? row.P.toFixed(2) : '') + ' · K ' + (row ? row.K.toFixed(2) : '') + '</p>' +
    '<p class="meta">Market sample is a score input, not the score. Fee on the curve is 2% (incl. 0.4% Meteora) once pools exist.</p>' +
    (relic ? '<p class="banner" data-relic-art>' + esc(RELIC_NOTE) + ' This token still trades. In the game it has no votes, rewards or pot.</p>' : '') +
    '<p class="meta">Hold any amount for 24h. Selling to zero resets the 24h clock.</p>' +
    '<div class="row">' +
    (relic ? '' : '<button class="btn solid" type="button" data-act="open" data-sheet="trial" data-char="' + c.id + '">Trial</button>') +
    (relic ? '' : '<button class="btn" type="button" data-act="open" data-sheet="train" data-char="' + c.id + '">Train</button>') +
    '<button class="btn" type="button" data-act="open" data-sheet="verify">Verify</button></div>');
}

function trialView() {
  const t = ui.trial;
  if (!t || !t.seed || !t.context) return null;
  return replayTrial(t.seed, t.moves || [], t.context);
}

function sheetTrial(s, c) {
  const t = ui.trial;
  if (!t || !t.seed) {
    sheetWrap('Daily Trial · ' + c.name, '<p data-trial-status>Dealing the hand…</p>');
    return;
  }
  const view = trialView();
  const left = Math.max(0, 60 - Math.floor((Date.now() - t.startedAt) / 1000));
  const art = view.art || '/play/assets/props/boss-wolf.webp';
  const cards = (view.hand || []).map((card) =>
    '<button class="tcard' + (card.signature ? ' sig' : '') + '" type="button" data-act="trial-play" data-card="' + card.index + '"' + (t.step === 'play' && !view.done ? '' : ' disabled') + '>' +
    '<i class="cost">' + card.cost + '</i>' +
    '<span class="art"><img src="' + heroSrc(c.id, 'alive') + '" alt=""></span>' +
    '<span class="ban">' + esc(card.name) + '</span>' +
    '<span class="tx">' + esc(card.text) + '</span>' +
    '<span class="ty">' + esc(card.type) + ' · ' + esc(card.stat) + '</span></button>'
  ).join('');
  let result = '';
  if (t.result) {
    const accuracy = Math.round((t.result.damagePercent != null ? t.result.damagePercent : (t.result.accuracy || 0) * 100));
    result = '<p data-trial-accuracy>' + accuracy + '%' + (t.result.counted ? ' · counted' : ' · practice') + '</p>' +
      '<pre class="log" data-trial-grid>' + esc(t.result.grid || t.result.reason || '') + '</pre>' +
      (t.result.counted || t.result.alreadyCounted
        ? '<button class="btn" type="button" data-act="trial-practice">Practice again</button>'
        : '');
  }
  const width = view.bossMax ? Math.round(100 * view.bossHp / view.bossMax) : 0;
  sheetWrap('Daily Trial · ' + c.name,
    '<div class="boss-card"><div class="boss-art">' +
    (view.art ? '<img src="' + esc(art) + '" alt="' + esc(view.boss) + '">' : '') +
    '<span class="var">' + esc(view.variant) + '</span>' +
    '<span class="intent">' + esc(view.intent ? view.intent.label : 'Done') + '</span>' +
    '</div><p class="bn">' + esc(view.blurb || '') + '</p>' +
    '<div class="hp"><i style="width:' + width + '%"></i></div>' +
    '<p data-trial-boss>' + esc(view.boss) + '</p>' +
    '<p class="trial-meta" data-trial-status>Turn ' + view.turn + ' / 8 · ' + view.energy + ' energy · ' + view.moves + ' / 30 moves · ' + left + 's · dealt ' + view.damagePercent + '%</p>' +
    '<div id="trial-stage" data-trial-engine="dom" hidden></div></div>' +
    '<div class="me-row">' + bustSvg(c, 46, 'alive') + '<div><strong>' + esc(c.name) + '</strong><span class="hpme"> ' + view.playerHp + '/' + view.playerMax + '</span><br><span class="meta">Block ' + view.playerBlock + ' · ' + esc(view.passive || '') + (view.underdog ? ' · underdog +' + view.underdog : '') + '</span></div></div>' +
    '<div class="trial-hand">' + cards + '</div>' +
    (t.step === 'play' && !view.done ? '<div class="row"><button class="btn" type="button" data-act="trial-end">End turn</button>' +
      '<button class="btn solid" type="button" data-act="trial-finish">Finish</button></div>' : '') +
    result +
    '<p class="footnote">Card upgrades are a stretch goal. They would change Trial power only, not Train. There is no raid boss.</p>' +
    (s.phase === 'P4' ? '<p class="footnote">Act before the Reaper. A day outside the window is not in K.</p>' : ''));
  if (t.step === 'play') {
    const host = document.getElementById('trial-stage');
    const token = (t.paintToken || 0) + 1;
    t.paintToken = token;
    paintTrial(host, {
      boss: view.boss,
      intentIcon: view.intent ? view.intent.icon : '•',
      hand: view.hand,
      hpLeft: view.bossHp,
      bossHp: view.bossMax
    }).then((paint) => {
      if (!ui.trial || ui.trial.paintToken !== token) { paint.destroy(); return; }
      ui.trialPaint = paint;
    });
    if (!t.clock) {
      t.clock = setInterval(() => {
        if (!ui.trial || ui.trial.step !== 'play') return;
        if (Date.now() - ui.trial.startedAt >= 60000) finishTrial();
        else {
          const status = document.querySelector('[data-trial-status]');
          const live = trialView();
          if (status && live) {
            const remain = Math.max(0, 60 - Math.floor((Date.now() - ui.trial.startedAt) / 1000));
            status.textContent = 'Turn ' + live.turn + ' / 8 · ' + live.energy + ' energy · ' + live.moves + ' / 30 moves · ' + remain + 's · dealt ' + live.damagePercent + '%';
          }
        }
      }, 500);
    }
  }
}

function sheetCrowd() {
  sheetWrap('Crowd vote',
    '<p>One tap this chapter. It changes the narration only. It does not change the score. +1 legacy point.</p>' +
    '<button class="choice" type="button" data-act="crowd" data-option="mercy">The margin asked for mercy.</button>' +
    '<button class="choice" type="button" data-act="crowd" data-option="ink">The ink was already sure.</button>' +
    '<button class="choice" type="button" data-act="crowd" data-option="page">Turn it and do not look back.</button>' +
    '<p data-crowd-note></p>');
}

function sheetRecap(s) {
  sheetWrap('Nightly recap', '<p data-recap>Loading chapter ' + s.chapter + '…</p>');
}

function sheetQuiz() {
  if (ui.quizResult) {
    const story = ui.quizResult.story || {};
    sheetWrap('Your character',
      '<p data-quiz-result>' + esc(ui.quizResult.character.name) + '</p>' +
      '<p class="voice">' + esc(story.voice || ui.quizResult.character.hook) + '</p>' +
      '<p>' + esc(story.hook || '') + '</p>');
    return;
  }
  const q = QUIZ[ui.quizAnswers.length];
  if (!q) {
    sheetWrap('Quiz', '<p>Sending four answers…</p>');
    return;
  }
  const options = q.options.map((label, index) =>
    '<button class="choice" type="button" data-act="quiz-pick" data-i="' + index + '">' + esc(label) + '</button>'
  ).join('');
  sheetWrap('Quiz · ' + (ui.quizAnswers.length + 1) + ' / 4', '<p>' + esc(q.prompt) + '</p>' + options);
}

function sheetStory(c) {
  sheetWrap(c.name, '<p data-story>Opening the storybook…</p>');
}

function sheetTrain(s, c) {
  const dead = c.id === s.relicId || (s.marked === c.id && (s.phase === 'P6' || s.revivalOpen));
  if (dead) {
    sheetWrap('Train · ' + c.name, '<p>Train is closed while ' + esc(c.name) + ' is dead. Revival is the only way back.</p>');
    return;
  }
  const left = Math.max(0, ui.train.holdUntil - Date.now());
  sheetWrap('Train · ' + c.name,
    '<p>Integer tBard, 10 to 5,000. 50% burned · 30% to liquidity · 20% to the test pot. One transaction.</p>' +
    '<p>Discounted slots: pay 100, credit 150, while a slot is held.</p>' +
    '<label>Amount <input class="field" id="train-amount" inputmode="numeric" value="' + ui.train.amount + '"></label>' +
    '<div class="row"><button class="btn" type="button" data-act="train-hold">Hold a discount slot</button>' +
    '<button class="btn solid" type="button" data-act="train-go" data-char="' + c.id + '">Train</button></div>' +
    (left ? '<p class="hold" data-hold>Discount slot held ' + Math.ceil(left / 1000) + 's</p>' : '') +
    '<p class="footnote">Your Train still builds stats; it counts as active once you are eligible. ' + esc(ELIGIBILITY_NOTE) + '</p>' +
    '<pre class="log" id="train-log"></pre>');
}

function sheetDecide(s, c) {
  const chapter = CHAPTERS[Math.max(0, s.chapter - 1)];
  const risk = { SAFE: '◇ SAFE', NORMAL: '◈ NORMAL', BOLD: '◆ BOLD' };
  const choices = chapter.choices.map((choice) =>
    '<button class="choice' + (ui.decideChoice === choice.id ? ' on' : '') + '" type="button" data-act="choice" data-id="' + choice.id + '">' +
    '<strong>' + esc(choice.label) + '</strong><br>' + choice.stat + ' · ' + risk[choice.risk] +
    '<br><span class="meta">' + choice.stat + ' ' + c.stats[choice.stat] + ' · Luck helps every choice. No odds are shown.</span></button>'
  ).join('');
  const closed = s.decideOpen ? '' : '<p class="banner">Decide is closed for this phase. Stakes return after the chapter closes. There is no unstake button.</p>';
  sheetWrap('Decide · ' + chapter.title,
    '<p>' + esc(chapter.scene) + '</p>' + closed + choices +
    '<p class="footnote">≥66% agreement adds a unity bonus. No votes means the SAFE choice, plus an apathy penalty. Votes move the encounter modifier by at most 3 points. Your weight is capped at 2%.</p>' +
    '<button class="btn solid" type="button" data-act="vote" data-char="' + c.id + '"' + (s.decideOpen ? '' : ' disabled') + '>Sign vote</button>');
}

function sheetRevive(s, c) {
  if (s.chapter >= 7 && s.phase === 'P6') {
    sheetWrap('Revival', '<p>The book is closing. Chapter 7 has no revival.</p>');
    return;
  }
  const row = s.rows.find((r) => r.id === c.id);
  const target = row ? Math.round(row.trainCredited * 0.35) : 5000;
  const clamped = Math.min(60000, Math.max(5000, target));
  const paid = ui.revivalPaid;
  const pct = Math.min(100, Math.round((paid / clamped) * 100));
  sheetWrap('Revive ' + c.name,
    '<p>You pay tBard → burned forever (100%), no refunds → revival bar moves. No refunds, even if the bar fails.</p>' +
    '<p>Anyone can contribute. Holding ' + esc(c.name) + ' is not required. Minimum 10 tBard.</p>' +
    '<div class="bar" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div>' +
    '<p class="num">' + pct + '% · ' + paid + ' / ' + clamped + ' tBard</p>' +
    '<label>Amount <input class="field" id="revive-amount" inputmode="numeric" value="500"></label>' +
    '<button class="btn reaper" type="button" data-act="revive-go" data-char="' + c.id + '">Burn tBard to revive ' + esc(c.name) + '</button>' +
    (ui.flash ? '<pre class="log">' + esc(ui.flash) + '</pre>' : ''));
}

async function sheetVerify(s) {
  sheetWrap('Verify', '<p>Loading the state-file plan…</p>');
  const state = {
    season: 's0',
    chapter: s.chapter,
    status: s.voided ? 'void' : 'final',
    void_reason: s.voided ? (s.voidReason || 'vrf') : undefined,
    phase: s.phase
  };
  const plan = s.voided
    ? await post('/api/season/void', { season: 's0', chapter: s.chapter, reason: s.voidReason || 'vrf', stakes: [] })
    : await post('/api/season/publish', { state });
  const host = document.querySelector('.sheet article');
  if (!host) return;
  const supabase = plan.supabaseUrl
    ? '<a data-verify="supabase" href="' + esc(plan.supabaseUrl) + '">Supabase Storage</a>'
    : '<span data-verify="supabase">Supabase Storage</span>';
  host.insertAdjacentHTML('beforeend',
    '<p>The memo hash is the proof. The file is in Supabase Storage, with a public GitHub mirror. There is no Arweave copy.</p>' +
    '<p>Memo</p><pre class="log">' + esc(plan.memo || '') + '</pre>' +
    '<p data-verify="hashes">File sha256 ' + esc(plan.fileHash || plan.hash || '') +
    '<br>Memo hash ' + esc(plan.memoHash || '') + ' ' + (plan.matches ? 'Matches ✓' : 'Does not match') + '</p>' +
    '<p>' + supabase + ' · ' + esc(plan.supabasePath || '') + '</p>' +
    '<p><a data-verify="github" href="' + esc(plan.githubUrl || '') + '">GitHub mirror</a></p>' +
    '<p class="footnote">The snapshot slot is shown here only after the mark. It is never counted down during the final window.</p>');
}

function sheetWords(s, c) {
  const n = graphemeLength(ui.draft);
  const counterClass = n >= 140 ? 'stop' : n >= 120 ? 'warn' : '';
  let extra = '';
  if (ui.wordsState === 'filter-rejected') extra = '<p class="warn" data-state="filter-rejected">' + esc(ui.wordsResult.reason) + '</p>';
  if (ui.wordsState === 'bot-rejected') {
    extra = '<p class="warn" data-state="bot-rejected">Your line was flagged: ' + esc(ui.wordsResult.category) +
      '. Bard will read the line the ink kept for ' + esc(c.name) + '. No appeals in Season 0.</p>';
  }
  if (ui.wordsState === 'bot-approved') extra = '<p data-state="bot-approved">Bard will read it on chapter night.</p><p class="voice">' + esc(ui.wordsResult.line) + '</p>';
  if (ui.wordsState === 'submitted') extra = '<p data-state="submitted">Your line is in. Rally your squad\'s votes.</p>';
  sheetWrap('Last words · ' + c.name,
    (ui.wallet ? '' : '<p>Sign in. Top-squad members write. Everyone else sees a read-only countdown.</p>') +
    '<label>Line <textarea class="field" id="words" maxlength="280" rows="3">' + esc(ui.draft) + '</textarea></label>' +
    '<p class="counter ' + counterClass + '" data-counter>' + n + ' / 140 graphemes</p>' +
    '<p class="meta">Filter blocks links, addresses, tickers, handles and slurs. Then a bot reviews. No human queue.</p>' +
    extra +
    '<button class="btn solid" type="button" data-act="words-submit" data-char="' + c.id + '">Submit line</button>' +
    '<p class="footnote">Fallback, if review fails: ' + esc(c.fallback) + '</p>');
}

function sheetSign() {
  const page = location.href;
  const android = /Android/i.test(navigator.userAgent);
  sheetWrap('Sign in to Bard',
    '<p>Sign in to Bard. Free, not a transaction.</p>' +
    '<div class="row"><button class="btn solid" type="button" data-act="wallet" data-which="phantom">Phantom</button>' +
    '<button class="btn" type="button" data-act="wallet" data-which="solflare">Solflare</button>' +
    '<button class="btn" type="button" data-act="wallet" data-which="backpack">Backpack</button>' +
    '<button class="btn" type="button" data-act="demo">Play without a wallet</button></div>' +
    (android ? '<p class="meta">On Android Chrome, a Mobile Wallet Adapter entry is listed when a wallet registers one.</p>' : '') +
    '<p class="meta">Open this page in the wallet app.</p>' +
    '<div class="row"><a class="btn" data-wallet-link="phantom" href="' + esc(phantomBrowseUrl(page)) + '">Open in Phantom</a>' +
    '<a class="btn" data-wallet-link="solflare" href="' + esc(solflareBrowseUrl(page)) + '">Open in Solflare</a></div>' +
    '<p class="footnote">This app pins devnet. A mainnet preflight shows how to switch that wallet.</p>');
}

function providerFor(which) {
  if (which === 'solflare') return window.solflare || null;
  if (which === 'backpack') return (window.backpack && (window.backpack.solana || window.backpack)) || null;
  return window.solana || (window.phantom && window.phantom.solana) || null;
}

function noteChainError(message) {
  if (!looksLikeMainnet(message)) return;
  ui.wrongNetwork = ui.walletKind || 'other';
  renderMain();
}

async function connectWallet(which) {
  ui.walletKind = which;
  const provider = providerFor(which);
  if (!provider) {
    toast('No ' + which + ' provider in this browser. Use Open in ' + which + ', or demo play on devnet.');
    return;
  }
  try {
    const res = await provider.connect();
    ui.wallet = (res && res.publicKey && res.publicKey.toString()) || provider.publicKey.toString();
    ui.walletState = 'signed-in';
    saveStore();
    closeSheet();
    renderMain();
    toast('Signed in · DEVNET');
  } catch {
    ui.walletState = 'signed-out';
    toast('Sign-in cancelled.');
  }
}

document.body.addEventListener('click', async (event) => {
  const node = event.target.closest('[data-act]');
  if (!node) return;
  const act = node.dataset.act;
  if (act === 'tab') {
    ui.tab = node.dataset.tab;
    renderMain();
    return;
  }
  if (act === 'close') { closeSheet(); return; }
  if (act === 'signin') { openSheet('signin'); return; }
  if (act === 'open') { openSheet(node.dataset.sheet, node.dataset.char); return; }
  if (act === 'demo') {
    ui.wallet = 'demo';
    ui.walletState = 'signed-in';
    saveStore();
    closeSheet();
    renderMain();
    toast('Demo sign-in on devnet. Signatures are marked demo.');
    return;
  }
  if (act === 'wallet') { await connectWallet(node.dataset.which); return; }
  if (act === 'choice') { ui.decideChoice = node.dataset.id; renderSheet(); return; }
  if (act === 'trial-play') { playTrialCard(node.dataset.card); return; }
  if (act === 'trial-end') { endTrialTurn(); return; }
  if (act === 'trial-finish') { await finishTrial(); return; }
  if (act === 'trial-practice') { await beginTrial(true); return; }
  if (act === 'letter') { await sendLetter(node.dataset.choice); return; }
  if (act === 'crowd') { await sendCrowd(node.dataset.option); return; }
  if (act === 'push-on') { await enablePush(); return; }
  if (act === 'quiz-pick') { await pickQuiz(Number(node.dataset.i)); return; }
  if (act === 'chest-odds') { await showOdds(); return; }
  if (act === 'legacy-check') { await showLegacy(); return; }
  if (act === 'train-hold') {
    ui.train.holdUntil = Date.now() + 120000;
    ui.train.state = 'slot-held';
    renderSheet();
    return;
  }
  if (act === 'train-go') { await train(node.dataset.char); return; }
  if (act === 'revive-go') { await revive(node.dataset.char); return; }
  if (act === 'vote') { await signAction('decide', node.dataset.char, ui.decideChoice || '-'); return; }
  if (act === 'pick') { await signAction('predict', node.dataset.char, node.dataset.char); return; }
  if (act === 'cheer') { await signAction('cheer', node.dataset.char, 'cheer'); return; }
  if (act === 'words-submit') { await submitWords(node.dataset.char); return; }
  if (act === 'faucet' || act === 'faucet-first') { await faucet(); return; }
  if (act === 'cosmetic') { toast('Tie goes to the first listed option. Recorded locally for ' + node.dataset.id + '.'); }
  if (act === 'back') {
    ui.backed = node.dataset.char;
    saveStore();
    renderMain();
    return;
  }
  if (act === 'impact') { await showImpact(); return; }
});

document.body.addEventListener('input', (event) => {
  if (event.target.id === 'words') {
    ui.draft = event.target.value;
    const n = graphemeLength(ui.draft);
    const counter = document.querySelector('[data-counter]');
    if (counter) {
      counter.textContent = n + ' / 140 graphemes';
      counter.className = 'counter' + (n >= 140 ? ' stop' : n >= 120 ? ' warn' : '');
    }
  }
  if (event.target.id === 'train-amount') ui.train.amount = Number(event.target.value);
});

async function beginTrial(practice) {
  stopTrialPaint();
  const now = Date.now();
  const s = screen();
  const charId = (ui.sheet && ui.sheet.charId) || ui.backed;
  ui.backed = charId;
  saveStore();
  const res = await post('/api/season/trial/start', {
    wallet: ui.wallet || 'demo',
    charId,
    chapter: s.chapter,
    inDanger: s.danger.includes(charId),
    practice: !!practice,
    now
  });
  if (!res.ok) { toast(res.reason || 'Trial failed'); return; }
  ui.trial = {
    seed: res.seed,
    day: res.day,
    context: res.context,
    practice: res.practice,
    moves: [],
    startedAt: now,
    step: 'play',
    clock: null,
    paintToken: 0
  };
  renderSheet();
}

function playTrialCard(index) {
  const t = ui.trial;
  const view = trialView();
  if (!t || t.step !== 'play' || !view || view.done) return;
  if (Date.now() - t.startedAt >= 60000) { finishTrial(); return; }
  const card = view.hand.find((item) => item.index === Number(index));
  if (!card) return;
  if (card.cost > view.energy) { toast('Not enough energy. End the turn.'); return; }
  t.moves.push({ type: 'play', card: Number(index) });
  const next = trialView();
  if (!next.ok) {
    t.moves.pop();
    toast(next.reason || 'That card cannot be played.');
    return;
  }
  if (next.done) { finishTrial(); return; }
  renderSheet();
}

function endTrialTurn() {
  const t = ui.trial;
  const view = trialView();
  if (!t || t.step !== 'play' || !view || view.done) return;
  t.moves.push({ type: 'end' });
  const next = trialView();
  if (next.done || next.moves >= 30) { finishTrial(); return; }
  renderSheet();
}

async function finishTrial() {
  const t = ui.trial;
  if (!t || t.step === 'result' || t.step === 'sending') return;
  t.step = 'sending';
  if (t.clock) { clearInterval(t.clock); t.clock = null; }
  const ctx = t.context || {};
  const result = await post('/api/season/trial/finish', {
    wallet: ui.wallet || 'demo',
    day: t.day,
    seed: t.seed,
    charId: ctx.charId,
    chapter: ctx.chapter,
    inDanger: ctx.inDanger,
    train: ctx.train,
    moves: t.moves,
    elapsedMs: Date.now() - t.startedAt,
    practice: !!t.practice,
    now: Date.now()
  });
  t.step = 'result';
  t.result = result.ok ? result : { ...result, grid: result.reason || 'rejected', accuracy: 0, damagePercent: 0 };
  if (result.ok) ui.lastAccuracy = result.accuracy;
  renderSheet();
  toast(result.ok ? (result.counted ? 'Counted for today. ' + result.damagePercent + '%.' : 'Practice. Not counted.') : (result.reason || 'Trial rejected'));
}

async function sendLetter(choice) {
  const result = await post('/api/season/letter', { wallet: ui.wallet || 'demo', choice, now: Date.now() });
  if (!result.ok) {
    ui.chest = null;
    ui.loopNote = result.reason === 'already' ? 'The letter is already open today.' : (result.reason || 'Letter failed');
    renderMain();
    return;
  }
  const chest = result.chest || {};
  ui.chest = chest;
  ui.loopNote = choice + ' · ' + (chest.rarity || 'chest') + ' · ' + (chest.item || '') + ' · cosmetic, not an NFT';
  renderMain();
}

async function showImpact() {
  const mine = { wallet: ui.wallet || 'demo', trialAccuracy: ui.lastAccuracy || 0, balance: 1000000 };
  const result = await post('/api/season/impact', {
    walletRow: mine,
    peers: [mine, { wallet: 'other', trialAccuracy: 0.5, balance: 1 }]
  });
  ui.impact = 'Contribution ' + result.cp + ' · your share ' + Math.round((result.share || 0) * 100) + '%. Holdings do not change it. The pool pays tBard, unlocked over 14 days.';
  if (ui.tab === 'me') renderMain();
  else toast(ui.impact);
}

async function sendCrowd(option) {
  const result = await post('/api/season/crowd-vote', {
    wallet: ui.wallet || 'demo',
    chapter: screen().chapter,
    option,
    now: Date.now()
  });
  const note = document.querySelector('[data-crowd-note]');
  const line = result.ok
    ? result.option.line + ' Narration only.'
    : (result.reason === 'already' ? 'You already voted this chapter.' : (result.reason || 'Vote failed'));
  if (note) note.textContent = line;
  else toast(line);
}

async function loadRecap() {
  const s = screen();
  const result = await fetch('/api/season/recap?chapter=' + s.chapter + '&now=' + Date.now() + '&wallet=' + encodeURIComponent(ui.wallet || 'demo')).then((r) => r.json());
  const el = document.querySelector('[data-recap]');
  if (!el) return;
  el.textContent = result.line || '';
}

async function loadStory(id) {
  const result = await fetch('/api/season/story?id=' + encodeURIComponent(id || 'pip')).then((r) => r.json());
  const el = document.querySelector('[data-story]');
  if (!el || !result.story) return;
  el.textContent = result.story.name + ' — ' + result.story.hook + ' ' + result.story.voice;
}

async function pickQuiz(index) {
  ui.quizAnswers.push(index);
  if (ui.quizAnswers.length < 4) { renderSheet(); return; }
  ui.quizResult = await post('/api/season/quiz', { answers: ui.quizAnswers });
  renderSheet();
}

async function showOdds() {
  const result = await fetch('/api/season/chest/odds').then((r) => r.json());
  const lines = (result.odds || []).map((row) => row.rarity + ' ' + Math.round(row.chance * 100) + '%').join(' · ');
  toast(lines + ' · rare within 10 opens · not for sale');
}

async function showLegacy() {
  const wallet = ui.wallet || 'demo';
  await post('/api/season/turnstile', { wallet, token: 'dev' });
  const result = await post('/api/season/legacy', { wallet, events: [{ id: 'shown', points: 0 }] });
  toast(result.qualified
    ? 'Counted ' + result.counted + ' / ' + result.cap + '. Cosmetic ' + result.cosmetic + '.'
    : 'Not qualified yet. Counted 0. Cosmetic ' + result.cosmetic + '. Turnstile and one on-chain action are required.');
}

async function enablePush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    toast('This browser has no web push. The cap is still 3 a day.');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifications stay off.'); return; }
  const vapid = await fetch('/api/season/push/vapid').then((r) => r.json());
  let subscription = { endpoint: 'local-opt-in', keys: null };
  if (vapid.publicKey) {
    const reg = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(vapid.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    subscription = sub.toJSON();
  }
  await post('/api/season/push/subscribe', { wallet: ui.wallet || 'demo', subscription });
  toast(vapid.publicKey ? 'Notifications on. Max 3 a day.' : 'Opt-in saved. Delivery is not configured. Cap is 3 a day.');
}

async function touchLoop(kind) {
  await post('/api/season/touch', { wallet: ui.wallet || 'demo', kind, now: Date.now() });
}

async function signAction(kind, charId, extra) {
  if (!ui.wallet) { openSheet('signin'); return; }
  const s = screen();
  const issued = await post('/api/season/strike-session', { wallet: ui.wallet, charId, chapter: s.chapter, action: kind });
  if (!issued.ok) { toast(issued.reason || 'No nonce'); return; }
  const signedAt = Date.now();
  const message = ['bard', 's0', kind, String(s.chapter), charId, issued.nonce, String(signedAt), extra || '-'].join('|');
  const body = {
    kind,
    wallet: ui.wallet,
    charId,
    chapter: s.chapter,
    nonce: issued.nonce,
    signedAt,
    signature: 'demo',
    message,
    extra: extra || '-',
    lockAt: s.predictLock,
    clientElapsedMs: 0,
    tapped: false
  };
  const result = await post('/api/season/action', body);
  if (kind === 'predict') {
    ui.pick = { charId, chapter: s.chapter, counts: !!result.counts, ok: result.ok };
    saveStore();
    renderMain();
    toast(result.ok ? 'Pick saved. Both timestamps were before the lock.' : 'Pick not counted (' + (result.reason || 'rejected') + ').');
    return;
  }
  if (kind === 'cheer') {
    ui.cheer = { day: new Date().toISOString().slice(0, 10), charId };
    saveStore();
    if (result.ok) await touchLoop('cheer');
    toast(result.ok ? 'Cheer signed. Streak can advance. It does not count as active. The drip may still be unconfigured.' : (result.reason || 'Cheer failed'));
    return;
  }
  if (result.ok && kind === 'decide') await touchLoop('vote');
  toast(result.ok ? 'Vote signed. Last vote before close counts. Not a transaction.' : (result.reason || 'Vote failed'));
}

async function train(charId) {
  const amount = Math.round(Number(document.getElementById('train-amount').value));
  const discount = ui.train.holdUntil > Date.now();
  const code = await post('/api/season/nonce', {
    action: 'train',
    wallet: ui.wallet || 'demo',
    charId,
    chapter: screen().chapter,
    amount,
    discount
  });
  const log = document.getElementById('train-log');
  if (!code.ok) {
    noteChainError(code.reason);
    if (log) log.textContent = code.reason || 'rejected';
    return;
  }
  if (!ui.publicInfo.tbardMint) {
    if (log) log.textContent = 'Spend code ready. Pools are not created on this devnet yet, so nothing was sent.\n' + code.memo + '\n50/30/20 base units ' + JSON.stringify(code.split);
    return;
  }
  if (log) log.textContent = code.memo;
}

async function revive(charId) {
  const amount = Math.round(Number(document.getElementById('revive-amount').value));
  const code = await post('/api/season/nonce', {
    action: 'revive',
    wallet: ui.wallet || 'demo',
    charId,
    chapter: screen().chapter,
    amount
  });
  if (!code.ok) {
    noteChainError(code.reason);
    ui.flash = code.reason || 'rejected';
    renderSheet();
    return;
  }
  ui.revivalPaid += amount;
  saveStore();
  ui.flash = 'Burn code ready. 100% burn. Nothing was broadcast (no mint configured).\n' + code.memo;
  toast('Burn code ready for ' + ((characterById(charId) || {}).name || 'them') + '. Nothing was sent.');
  renderSheet();
}

async function submitWords(charId) {
  const text = (document.getElementById('words') || {}).value || ui.draft;
  ui.draft = text;
  if (graphemeLength(text) > 140) {
    ui.wordsState = 'filter-rejected';
    ui.wordsResult = { reason: 'Over 140 graphemes.' };
    renderSheet();
    return;
  }
  const review = await post('/api/season/last-words/review', { text });
  if (!review.filter.ok) {
    ui.wordsState = 'filter-rejected';
    ui.wordsResult = { reason: review.filter.reason };
    renderSheet();
    return;
  }
  if (!review.review.ok) {
    ui.wordsState = 'bot-rejected';
    ui.wordsResult = { category: review.review.category };
    renderSheet();
    return;
  }
  const character = characterById(charId);
  const resolved = await post('/api/season/last-words/resolve', {
    submissions: [{ text, votes: 1, wallet: ui.wallet || 'demo', submittedAt: Date.now() }],
    fallback: character.fallback
  });
  ui.wordsState = resolved.source === 'squad' ? 'bot-approved' : 'bot-rejected';
  ui.wordsResult = resolved;
  renderSheet();
}

async function faucet() {
  const result = await post('/api/season/faucet', { wallet: ui.wallet || 'demo' });
  toast(result.reason === 'drip_not_configured'
    ? 'Drip wallet is not configured. Nothing was sent. Run the devnet prefund script, then set BARD_DRIP_SECRET.'
    : (result.hint || result.reason || 'Faucet unavailable'));
}

async function loadEligibility() {
  const snap = Date.now();
  const held = snap - 20 * 3600 * 1000;
  const res = await fetch('/api/eligibility?cluster=devnet&balance=1&heldSince=' + held + '&snapshot=' + snap + '&valueSol=0');
  ui.eligibility = await res.json();
  if (ui.tab === 'me') renderMain();
}

async function boot() {
  try {
    const cfg = await fetch('/api/season/config').then((r) => r.json());
    if (cfg.config) ui.config = cfg.config;
  } catch { /* local defaults already set */ }
  try {
    ui.publicInfo = await fetch('/season0/devnet.public.json').then((r) => r.json());
  } catch { /* pools stay empty */ }
  renderMain();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/play/sw.js', { scope: '/play/' }).catch(() => {});
  }
  await loadEligibility();
  const sheet = params.get('sheet');
  if (sheet) openSheet(sheet, params.get('char') || 'pip');
  setInterval(() => {
    const headline = document.querySelector('[data-clock="headline"]');
    if (!headline || ui.sheet) return;
    const copy = headerCopy(screen());
    headline.textContent = copy.title;
    const note = document.querySelector('[data-clock="footnote"]');
    if (note) note.textContent = copy.footnote;
  }, 1000);
}

boot();
