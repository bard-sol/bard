import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONSENT_TEXT,
  LABEL_OTHER_CAMPAIGN,
  LABEL_SAME_CAMPAIGN,
  RULE_V1,
  canonicalJson,
  log2Milli,
  nearDuplicate,
  postedAtFromId,
  scoreCampaign,
  snowflakeId,
} from '../../scoring.js';
import { computePayouts } from '../../server/settlement.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EPOCH = 1288834974657;

function at(iso, seq) {
  return snowflakeId(Date.parse(iso), seq);
}

function baseInputs(over = {}) {
  return {
    rule: { version: 'bard-score-v1', bestN: 5 },
    campaign: {
      id: 'camp',
      starts_at: '2026-06-01T00:00:00.000Z',
      ends_at: '2026-06-15T00:00:00.000Z',
      season: '2026-Q2',
    },
    accounts: [],
    posts: [],
    engagements: [],
    joins: [],
    season_joins: [],
    holders: [],
    overrides: [],
    ...over,
  };
}

function person(handle, wallet, userId, createdOn, followers, following, extra = {}) {
  return {
    account: { handle, created_on: createdOn, followers, following, is_bot: extra.is_bot === true },
    holder: { wallet, handle, x_user_id: userId, x_via: extra.x_via || 'oauth' },
    join: {
      wallet,
      handle,
      x_user_id: userId,
      status: extra.status || 'approved',
      joined_at: '2026-06-01T00:00:00.000Z',
      score_override: extra.score_override || null,
      override_at: extra.override_at || null,
      override_by: extra.override_by || null,
      consent: true,
    },
  };
}

function addPerson(inputs, p) {
  inputs.accounts.push(p.account);
  inputs.holders.push(p.holder);
  inputs.joins.push(p.join);
}

const POSTED = '2026-06-02T12:00:00.000Z';
const CHECKED = '2026-06-06T12:00:00.000Z';
const OLD = '2025-04-28';

test('join pages carry the consent text and the receipt button is created in script', async () => {
  const campaign = await readFile(path.join(root, 'campaign.html'), 'utf8');
  const dashboard = await readFile(path.join(root, 'dashboard.html'), 'utf8');
  const receipt = await readFile(path.join(root, 'receipt.html'), 'utf8');
  const admin = await readFile(path.join(root, 'admin.html'), 'utf8');
  assert.equal(campaign.includes(CONSENT_TEXT), true);
  assert.equal(dashboard.includes(CONSENT_TEXT), true);
  assert.equal(receipt.includes('src="/scoring.js"'), true);
  assert.equal(admin.includes('src="/scoring.js"'), true);
  assert.equal(receipt.includes('>Recompute here<'), false);
  assert.equal(receipt.includes("button.textContent = 'Recompute here'"), true);
});

test('log2Milli matches the published whole-number points', () => {
  assert.equal(log2Milli(0), 0);
  assert.equal(log2Milli(1000), 1000);
  assert.equal(log2Milli(3000), 2000);
  assert.equal(log2Milli(24000), 4643);
  assert.equal(log2Milli(2400000), 11229);
  assert.equal(log2Milli('24000'), 4643);
});

test('posted_at comes from the post id', () => {
  const id = at(POSTED, 1);
  assert.equal(postedAtFromId(id), POSTED);
  const ms = Number((BigInt(id) >> 22n) + BigInt(EPOCH));
  assert.equal(ms, Date.parse(POSTED));
});

test('canonicalJson sorts object keys and keeps array order', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 1, c: [2, 1] } }), '{"a":{"c":[2,1],"d":1},"b":1}');
  assert.equal(canonicalJson({ z: undefined, a: null }), '{"a":null,"z":null}');
});

test('nearDuplicate uses 5-character sets and Jaccard at least 0.6', () => {
  assert.equal(nearDuplicate('', ''), false);
  assert.equal(nearDuplicate('hi', 'hi'), true);
  assert.equal(nearDuplicate('hi', 'yo'), false);
  const line = 'alpha market note about shipping the public score rule this week with full receipts';
  assert.equal(nearDuplicate(line, line), true);
  assert.equal(nearDuplicate(line, line + ' https://example.com @Someone #tag'), true);
  assert.equal(nearDuplicate('completely different words about vaults and keys', line), false);
  const shared = 'bbbbbcccccdddddeeeeefffffggggg';
  assert.equal(nearDuplicate(shared + 'aaaaa', shared + 'hhhhh'), true);
  assert.equal(nearDuplicate('aaaaabbbbb', 'cccccddddd'), false);
});

test('section 1 account gate zeros posts when link, followers, or age fails', () => {
  const wallet = 'Wgate';
  const id = at(POSTED, 1);
  const inputs = baseInputs();
  addPerson(inputs, person('gate', wallet, '501', OLD, 800, 300));
  inputs.posts.push({ post_id: id, wallet, handle: 'gate', text: 'a gate post that is long enough to stand alone', deleted: false, checked_at: CHECKED, excluded: false });
  inputs.engagements.push({ post_id: id, handle: 'out', kind: 'reply' });
  inputs.accounts.push({ handle: 'out', created_on: OLD, followers: 800, following: 300, is_bot: false });
  const pass = scoreCampaign(inputs).results.find((row) => row.wallet === wallet);
  assert.equal(pass.posts[0].reason, null);
  assert.ok(pass.posts[0].score_milli > 0);

  const young = structuredClone(inputs);
  young.accounts.find((row) => row.handle === 'gate').created_on = '2026-05-23';
  const aged = scoreCampaign(young).results.find((row) => row.wallet === wallet);
  assert.equal(aged.posts[0].reason, 'account_age');
  assert.equal(aged.score_milli, 0);

  const thin = structuredClone(inputs);
  thin.accounts.find((row) => row.handle === 'gate').followers = 49;
  assert.equal(scoreCampaign(thin).results[0].posts[0].reason, 'followers');

  const bare = structuredClone(inputs);
  bare.holders[0].x_via = 'unverified';
  assert.equal(scoreCampaign(bare).results[0].posts[0].reason, 'unverified');

  const twin = structuredClone(inputs);
  twin.holders.push({ wallet: 'Wother', handle: 'gate', x_user_id: '501', x_via: 'oauth' });
  assert.equal(scoreCampaign(twin).results.find((row) => row.wallet === wallet).posts[0].reason, 'not_one_wallet');
});

test('section 2 posts count only inside the window, after 72 hours, and not deleted', () => {
  const wallet = 'Wpost';
  const inputs = baseInputs();
  addPerson(inputs, person('poster', wallet, '502', OLD, 80, 10));
  const id = at(POSTED, 2);
  inputs.posts.push({ post_id: id, wallet, handle: 'poster', text: 'window check post text here', deleted: false, checked_at: CHECKED, excluded: false });
  const ok = scoreCampaign(inputs).results[0].posts[0];
  assert.equal(ok.reason, null);

  const early = structuredClone(inputs);
  early.posts[0].checked_at = '2026-06-05T11:00:00.000Z';
  assert.equal(scoreCampaign(early).results[0].posts[0].reason, 'unchecked_72h');

  const exact = structuredClone(inputs);
  exact.posts[0].checked_at = new Date(Date.parse(POSTED) + 72 * 3600 * 1000).toISOString();
  assert.equal(scoreCampaign(exact).results[0].posts[0].reason, null);

  const gone = structuredClone(inputs);
  gone.posts[0].deleted = true;
  assert.equal(scoreCampaign(gone).results[0].posts[0].reason, 'deleted');

  const outside = structuredClone(inputs);
  const lateId = at('2026-07-01T00:00:00.000Z', 1);
  outside.posts[0].post_id = lateId;
  outside.posts[0].checked_at = '2026-07-05T00:00:00.000Z';
  outside.engagements = [];
  assert.equal(scoreCampaign(outside).results[0].posts[0].reason, 'outside_window');
});

test('section 3 engager weight follows age, ratio, and class', () => {
  const wallet = 'Wweight';
  const id = at(POSTED, 3);
  function run(account, extra = {}) {
    const inputs = baseInputs();
    addPerson(inputs, person('poster', wallet, '503', OLD, 80, 10));
    inputs.accounts.push(account);
    inputs.posts.push({ post_id: id, wallet, handle: 'poster', text: 'weight post text is unique here', deleted: false, checked_at: CHECKED, excluded: false });
    inputs.engagements.push({ post_id: id, handle: account.handle, kind: 'repost' });
    if (extra.holder) inputs.holders.push(extra.holder);
    if (extra.season) inputs.season_joins.push(extra.season);
    if (extra.join) inputs.joins.push(extra.join);
    const found = scoreCampaign(inputs).results.find((row) => row.wallet === wallet);
    return found.posts[0].engagers[0];
  }
  const full = run({ handle: 'full', created_on: OLD, followers: 800, following: 300, is_bot: false });
  assert.equal(full.weight, 1000);
  assert.equal(full.class, 'outside');
  assert.equal(full.label, '');

  const young = run({ handle: 'young', created_on: '2026-05-20', followers: 800, following: 300, is_bot: false });
  assert.equal(young.weight, 0);

  const tiny = run({ handle: 'tiny', created_on: OLD, followers: 9, following: 10, is_bot: false });
  assert.equal(tiny.weight, 0);

  const ratio = run({ handle: 'ratio', created_on: OLD, followers: 10, following: 100, is_bot: false });
  assert.equal(ratio.weight, 200);

  const poster = run({ handle: 'poster', created_on: OLD, followers: 800, following: 300, is_bot: false });
  assert.equal(poster.class, 'poster');
  assert.equal(poster.weight, 0);
  assert.equal(poster.label, '');

  const joined = run(
    { handle: 'member', created_on: OLD, followers: 800, following: 300, is_bot: false },
    { join: { wallet: 'Wmember', handle: 'member', status: 'rejected', score_override: null } }
  );
  assert.equal(joined.class, 'same_campaign');
  assert.equal(joined.label, LABEL_SAME_CAMPAIGN);
  assert.equal(joined.weight, 0);

  const botJoin = run(
    { handle: 'botmember', created_on: OLD, followers: 800, following: 300, is_bot: true },
    { join: { wallet: 'Wbot', handle: 'botmember', status: 'approved', score_override: null } }
  );
  assert.equal(botJoin.class, 'same_campaign');
  assert.equal(botJoin.label, LABEL_SAME_CAMPAIGN);

  const bot = run({ handle: 'bot', created_on: OLD, followers: 800, following: 300, is_bot: true });
  assert.equal(bot.class, 'bot');
  assert.equal(bot.weight, 0);
  assert.equal(bot.label, '');

  const half = run(
    { handle: 'season', created_on: OLD, followers: 800, following: 300, is_bot: false },
    {
      holder: { wallet: 'Wseason', handle: 'season', x_user_id: '900', x_via: 'oauth' },
      season: { handle: 'season', x_user_id: '900', campaign_id: 'other', joined_at: '2026-05-01T00:00:00.000Z' },
    }
  );
  assert.equal(half.class, 'other_campaign');
  assert.equal(half.label, LABEL_OTHER_CAMPAIGN);
  assert.equal(half.weight, 500);

  const holdOnly = run(
    { handle: 'holdonly', created_on: OLD, followers: 800, following: 300, is_bot: false },
    { holder: { wallet: 'Whold', handle: 'holdonly', x_user_id: null, x_via: 'manual' } }
  );
  assert.equal(holdOnly.class, 'outside');
  assert.equal(holdOnly.label, '');
  assert.equal(holdOnly.weight, 1000);
  assert.equal(holdOnly.source, 'entered by the team');
});

test('section 4 one account counts once at its highest kind', () => {
  const wallet = 'Wkind';
  const id = at(POSTED, 4);
  const inputs = baseInputs();
  addPerson(inputs, person('poster', wallet, '504', OLD, 80, 10));
  inputs.accounts.push({ handle: 'fan', created_on: OLD, followers: 800, following: 300, is_bot: false });
  inputs.posts.push({ post_id: id, wallet, handle: 'poster', text: 'kind post text is unique here', deleted: false, checked_at: CHECKED, excluded: false });
  inputs.engagements.push(
    { post_id: id, handle: 'fan', kind: 'like' },
    { post_id: id, handle: 'fan', kind: 'repost' },
    { post_id: id, handle: 'fan', kind: 'reply' },
    { post_id: id, handle: 'fan', kind: 'nope' }
  );
  const post = scoreCampaign(inputs).results[0].posts[0];
  assert.equal(post.engagers.length, 1);
  assert.equal(post.engagers[0].kind, 'reply');
  assert.equal(post.T, 3000);
  assert.equal(post.score_milli, 2000);
});

test('section 5 post score is the whole-number log', () => {
  const wallet = 'Wlog';
  const id = at(POSTED, 5);
  const inputs = baseInputs();
  addPerson(inputs, person('poster', wallet, '505', OLD, 80, 10));
  for (let i = 0; i < 4; i++) {
    inputs.accounts.push({ handle: 'r' + i, created_on: OLD, followers: 800, following: 300, is_bot: false });
    inputs.engagements.push({ post_id: id, handle: 'r' + i, kind: 'reply' });
  }
  for (let i = 0; i < 6; i++) {
    inputs.accounts.push({ handle: 'p' + i, created_on: OLD, followers: 800, following: 300, is_bot: false });
    inputs.engagements.push({ post_id: id, handle: 'p' + i, kind: 'repost' });
  }
  inputs.posts.push({ post_id: id, wallet, handle: 'poster', text: 'log post text is unique here', deleted: false, checked_at: CHECKED, excluded: false });
  const post = scoreCampaign(inputs).results[0].posts[0];
  assert.equal(post.T, 24000);
  assert.equal(post.score_milli, 4643);
});

test('section 6 the earliest post keeps its score and later copies score 0', () => {
  const wallet = 'Wdup';
  const other = 'Wcopy';
  const inputs = baseInputs();
  addPerson(inputs, person('first', wallet, '506', OLD, 80, 10));
  addPerson(inputs, person('second', other, '507', OLD, 80, 10));
  const text = 'same sentence about the score rule being public and checked by anyone';
  const early = at(POSTED, 1);
  const late = at(POSTED, 9);
  inputs.posts.push(
    { post_id: late, wallet: other, handle: 'second', text, deleted: false, checked_at: CHECKED, excluded: false },
    { post_id: early, wallet, handle: 'first', text, deleted: true, checked_at: CHECKED, excluded: false }
  );
  const scored = scoreCampaign(inputs);
  const kept = scored.results.find((row) => row.wallet === wallet).posts[0];
  const copy = scored.results.find((row) => row.wallet === other).posts[0];
  assert.equal(kept.reason, 'deleted');
  assert.equal(copy.reason, 'near_duplicate');
  assert.equal(copy.near_duplicate_of, early);
  assert.equal(copy.score_milli, 0);
});

test('section 7 campaign score is the best N posts', () => {
  const wallet = 'Wbest';
  const inputs = baseInputs({ rule: { version: 'bard-score-v1', bestN: 2 } });
  addPerson(inputs, person('best', wallet, '508', OLD, 80, 10));
  inputs.accounts.push({ handle: 'fan', created_on: OLD, followers: 800, following: 300, is_bot: false });
  const texts = ['one unique post about alpha', 'two unique post about bravo', 'three unique post about charlie'];
  texts.forEach((text, i) => {
    const id = at(POSTED, 20 + i);
    inputs.posts.push({ post_id: id, wallet, handle: 'best', text, deleted: false, checked_at: CHECKED, excluded: false });
    if (i < 2) inputs.engagements.push({ post_id: id, handle: 'fan', kind: 'reply' });
  });
  const row = scoreCampaign(inputs).results[0];
  assert.equal(row.posts.filter((post) => post.score_milli === 2000).length, 2);
  assert.equal(row.score_milli, 4000);
  assert.throws(() => scoreCampaign(baseInputs({ rule: { version: 'nope', bestN: 5 } })), /unknown score rule/);
  assert.throws(() => scoreCampaign(baseInputs({ rule: { version: 'bard-score-v1', bestN: 11 } })), /bestN/);
});

test('section 8 overrides never type a score', () => {
  const wallet = 'Wover';
  const id = at(POSTED, 30);
  const inputs = baseInputs();
  addPerson(inputs, person('over', wallet, '509', OLD, 80, 10));
  inputs.accounts.push({ handle: 'fan', created_on: OLD, followers: 800, following: 300, is_bot: false });
  inputs.posts.push({ post_id: id, wallet, handle: 'over', text: 'override post text is unique', deleted: false, checked_at: CHECKED, excluded: false });
  inputs.engagements.push({ post_id: id, handle: 'fan', kind: 'reply' });
  const open = scoreCampaign(inputs).results[0];
  assert.equal(open.score_milli, 2000);

  const dropPost = structuredClone(inputs);
  dropPost.posts[0].excluded = true;
  dropPost.overrides.push({ action: 'exclude_post', post_id: id, actor: 'team', at: '2026-06-07T00:00:00.000Z' });
  const excludedPost = scoreCampaign(dropPost).results[0];
  assert.equal(excludedPost.posts[0].reason, 'excluded');
  assert.equal(excludedPost.posts[0].score_milli, 0);
  assert.equal(excludedPost.score_milli, 0);

  const dropPerson = structuredClone(inputs);
  dropPerson.joins[0].score_override = 'exclude';
  dropPerson.overrides.push({ action: 'exclude_person', wallet, actor: 'team', at: '2026-06-07T00:00:00.000Z' });
  const excluded = scoreCampaign(dropPerson).results[0];
  assert.equal(excluded.posts[0].score_milli, 2000);
  assert.equal(excluded.score_milli, 0);
  assert.equal(excluded.excluded, true);
  assert.equal(excluded.override.actor, 'team');

  const include = baseInputs();
  addPerson(include, person('zero', wallet, '510', OLD, 80, 10, { score_override: 'include' }));
  include.overrides.push({ action: 'include_person', wallet, actor: 'ada', at: '2026-06-07T01:00:00.000Z' });
  const added = scoreCampaign(include).results[0];
  assert.equal(added.score_milli, 0);
  assert.equal(added.included, true);
  assert.equal(added.override.actor, 'ada');

  const both = structuredClone(dropPerson);
  both.joins[0].score_override = 'exclude';
  const fight = scoreCampaign(both).results[0];
  assert.equal(fight.excluded, true);
  assert.equal(fight.included, false);
});

test('the five fake accounts and the copier', async () => {
  const file = path.join(root, 'tests/fixtures/scoring/campaign.json');
  const fixture = JSON.parse(await readFile(file, 'utf8'));
  const scored = scoreCampaign(fixture.inputs);
  const byHandle = new Map(scored.results.map((row) => [row.handle, row.score_milli]));
  assert.equal(byHandle.get('honest'), 23215);
  for (const handle of ['ring1', 'ring2', 'ring3', 'newbie', 'spammer', 'deleter', 'copier']) {
    assert.equal(byHandle.get(handle), 0, handle);
  }
  const honest = scored.results.find((row) => row.handle === 'honest');
  assert.equal(honest.posts.length, 5);
  assert.ok(honest.posts.every((post) => post.score_milli === 4643 && post.T === 24000));
  const copier = scored.results.find((row) => row.handle === 'copier');
  assert.equal(copier.posts[0].reason, 'near_duplicate');
  assert.equal(copier.posts[0].T, 24000);
  const spam = scored.results.find((row) => row.handle === 'spammer');
  assert.equal(spam.posts.filter((post) => post.reason === 'near_duplicate').length, 19);
  assert.equal(fixture.consentText, CONSENT_TEXT);
});

test('a scored pool pays 23215 and 1585 in proportion and ignores qualified', () => {
  const high = 'WalletHigh111111111111111111111111111';
  const low = 'WalletLow1111111111111111111111111111';
  const campaign = {
    reward_mode: 'pool',
    prize_raw: '24800',
    reward_unit: 'TOKEN',
    config: { scoreRule: RULE_V1 },
    created_at: '2026-06-01T00:00:00.000Z',
    duration_days: 14,
  };
  const joins = [
    { wallet: low, status: 'approved', progress: 1585, qualified: true },
    { wallet: high, status: 'approved', progress: 23215, qualified: false },
  ];
  const paid = computePayouts(campaign, joins, 0);
  const amounts = Object.fromEntries(paid.payouts.map((row) => [row.wallet, row.amountRaw]));
  assert.equal(amounts[high], '23215');
  assert.equal(amounts[low], '1585');
});
