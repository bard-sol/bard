/**
 * Scenario 9. The scoring rule (TRAA-1988) on for one campaign and off for another. Scoring is a
 * worker flag that freezes the rule into each campaign created while it is on, so the team makes
 * campaign A with the flag off and campaign B with it on. The same holders join both. A is paid
 * from the team's hand points; B only from engagement the team enters through the score API,
 * with the rule's gates: consent to join, verified X, posts at least 72 hours old and inside the
 * window, payment 72 hours after the end, bots and excluded people at zero, near-duplicate posts
 * dropped, and inputs frozen once a payout is proposed.
 *
 * Linking X is OAuth in production; here the service role writes the verified link, as the
 * OAuth callback does. Time moves by backdating the campaigns and their joins.
 */
import { check, checkEqual, ok, refused } from '../lib/harness.mjs';
import {
  openSim, closeSim, makeTeam, makeHolders, launchProject, createCampaign,
  expectedLock, joinAll, joinRows, settle, human, labelOf,
} from '../lib/journey.mjs';
import { expectedTop3 } from '../lib/expect.mjs';
import { createHash } from 'node:crypto';
import { snowflakeId, canonicalJson, scoreCampaign } from '../../../scoring.js';
import { hashScoreInputs, recomputeScoreNote } from '../../../receipt_score.js';

const DAY = 86400000;
const CONSENT_VERSION = 'bard-score-v1';

const WORDS = ('moon chart volume holder vault team roadmap launch staking burn supply wallet airdrop '
  + 'community meme liquidity pool market candle whale dip pump floor bridge swap yield token governance '
  + 'proposal vote audit contract builder sprint release mainnet devnet ledger signer reward bounty quest '
  + 'season leaderboard referral invite friend thread reply quote repost like follower bot spam proof '
  + 'receipt payout schedule cliff vesting unlock treasury budget grant partner listing exchange fee').split(' ');

/** Post text that shares no run of words with another post, so the near-duplicate rule leaves it. */
function postText(rng) {
  return rng.sample(WORDS, 16).join(' ');
}

function dayOnly(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export default {
  id: 's9',
  name: 'Scoring rule on for one campaign and off for another',
  async run(ctx) {
    const { rng, step } = ctx;
    let sim;
    try {
      sim = await openSim(ctx, { scored: false });
      const env = sim.world.env;
      const decimals = rng.pick([0, 6]);
      const unit = 10n ** BigInt(decimals);
      const prizeA = BigInt(rng.int(10, 500)) * unit;
      const prizeB = BigInt(rng.int(10, 500)) * unit;
      const team = await step('team signs in', async () => makeTeam(sim, 'team'));
      const project = await step('launch the project', async () => {
        const deposit = expectedLock(prizeA, 500n).lockedRaw + expectedLock(prizeB, 500n).lockedRaw;
        const p = await launchProject(sim, team, { name: 'Scored Project', ticker: 'SCOR', decimals, depositRaw: deposit });
        return { p, detail: 'vault holds ' + human(deposit, decimals) };
      }).then((v) => v.p);

      const [plain, scored] = await step('campaign A is made with scoring off, campaign B with scoring on', async () => {
        checkEqual(ok(await sim.world.api('GET', '/api/config'), 'config').scoredCampaigns, false, 'flag before A');
        const a = await createCampaign(sim, project, { title: 'A hand points', type: 'custom', rule: 'Top 3 by points.', rewardMode: 'top3', prize: human(prizeA, decimals), days: 7 });
        env.SCORED_CAMPAIGNS = 'true';
        checkEqual(ok(await sim.world.api('GET', '/api/config'), 'config').scoredCampaigns, true, 'flag before B');
        const b = await createCampaign(sim, project, { title: 'B scored', type: 'custom', rule: 'Top 3 by engagement score.', rewardMode: 'top3', prize: human(prizeB, decimals), days: 7 });
        check(!(a.config && a.config.scoreRule), 'A has a score rule');
        check(b.config && b.config.scoreRule && b.config.scoreRule.version === CONSENT_VERSION, 'B has no frozen score rule');
        await refused(() => sim.world.api('POST', '/api/campaigns/' + b.id + '/score/rule', { bestN: 1 }, team.token), /frozen/, 'changing B\'s rule');
        await refused(() => sim.world.rest('PATCH', '/campaigns?id=eq.' + b.id, { config: {} }), null, 'stripping B\'s rule with the service role');
        return [a, b];
      });

      await step('A has no score API; B\'s score API is only for its team and only while the flag is on, and B takes no draw', async () => {
        await refused(() => sim.world.api('POST', '/api/campaigns/' + plain.id + '/score/accounts', { accounts: [{ handle: 'x', created_on: '2020-01-01', followers: 1, following: 1 }] }, team.token), /not scored/, 'score entry on A');
        // An unscored campaign answers like a missing one, so check the status, not the refusal text.
        checkEqual((await sim.world.api('GET', '/api/campaigns/' + plain.id + '/score')).status, 404, 'public score of A');
        checkEqual((await sim.world.api('GET', '/api/campaigns/' + scored.id + '/score')).status, 200, 'public score of B');
        env.SCORED_CAMPAIGNS = 'false';
        await refused(() => sim.world.api('POST', '/api/campaigns/' + scored.id + '/score/accounts', { accounts: [{ handle: 'x', created_on: '2020-01-01', followers: 1, following: 1 }] }, team.token), /scoring is off/, 'score entry with the flag off');
        const stillScored = ok(await sim.world.rest('GET', '/campaigns?id=eq.' + scored.id + '&select=config'), 'campaign')[0];
        check(stillScored.config.scoreRule, 'turning the flag off removed B\'s rule');
        env.SCORED_CAMPAIGNS = 'true';
        await refused(() => team.platform.commitDraw(scored.id, 0), /scored campaign/, 'a draw on B');
        return 'A: not scored; B: entry refused while the flag is off, rule kept, draw refused';
      });

      const holders = await makeHolders(sim, ctx.holderCount(7, 14));
      // Every holder links X except one, who stays unverified.
      const unverified = holders[holders.length - 1];
      let xid = 7000;
      for (const h of holders) {
        h.handle = 'sim_' + h.label.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        if (h === unverified) continue;
        xid += 1;
        const saved = ok(await sim.world.rest('POST', '/holders?on_conflict=wallet', { wallet: h.wallet, x_handle: '@' + h.handle, x_via: 'oauth', x_user_id: String(xid), x_linked_at: new Date().toISOString() }, 'service', { prefer: 'resolution=merge-duplicates,return=representation' }), 'link X for ' + h.label);
        checkEqual([saved[0].x_via, saved[0].x_user_id], ['oauth', String(xid)], 'X link for ' + h.label);
      }

      await step('holders join both; B needs the score consent, A does not', async () => {
        await joinAll(project, plain, holders);
        const h0 = holders[0];
        await refused(() => h0.platform.joinCampaign(project.id, scored.id, h0.wallet, null, false, null, null, null), /consent/, 'joining B without consent');
        for (const h of holders) {
          // campaign.html passes the linked handle; a holder without verified X has none.
          const linked = h === unverified ? null : '@' + h.handle;
          await h.platform.joinCampaign(project.id, scored.id, h.wallet, linked, false, null, null, { at: new Date().toISOString(), version: CONSENT_VERSION });
        }
        const rowsA = await joinRows(sim, plain.id);
        const rowsB = await joinRows(sim, scored.id);
        checkEqual([rowsA.length, rowsB.length], [holders.length, holders.length], 'joins');
        check(rowsA.every((r) => r.handle_consent_version == null), 'A stored a consent');
        check(rowsB.every((r) => r.handle_consent_version === CONSENT_VERSION), 'B join without consent');
        const linked = rowsB.find((r) => r.wallet === h0.wallet);
        checkEqual(linked.x_handle, '@' + h0.handle, 'B join carries the verified handle');
        return holders.length + ' holders in both; ' + (holders.length - 1) + ' with verified X';
      });

      await step('the team scores A by hand; B refuses hand points and qualification', async () => {
        for (const h of holders) await team.platform.setJoinProgress(plain.id, h.wallet, rng.int(1, 1000), null);
        await refused(() => team.platform.setJoinProgress(scored.id, holders[0].wallet, 999, null), /no hand score/, 'hand points on B');
        await refused(() => team.platform.markQualified(project.id, scored.id, holders[0].wallet), /no hand score/, 'qualify on B');
        await refused(() => sim.world.api('POST', '/api/campaigns/' + scored.id + '/score/posts', { posts: [{ post_id: '1', wallet: holders[0].wallet, handle: holders[0].handle }], score_milli: 1 }, team.token), /cannot be typed/, 'a typed score');
        const rowsB = await joinRows(sim, scored.id);
        check(rowsB.every((r) => Number(r.progress) === 0 && !r.qualified), 'B has hand points');
        return 'A has points; B has none';
      });

      await step('B refuses a post younger than 72 hours and cannot be paid before 72 hours after the end', async () => {
        const young = snowflakeId(Date.now() - 3600000, 1);
        await refused(() => sim.world.api('POST', '/api/campaigns/' + scored.id + '/score/posts', { posts: [{ post_id: young, wallet: holders[0].wallet, handle: holders[0].handle, text: 'too new' }] }, team.token), /younger than 72 hours/, 'a young post');
        await team.platform.updateCampaignStatus(scored.id, 'ended');
        await refused(() => team.platform.proposeSettlement(project.id, scored.id), /settlement opens/, 'paying B early');
        return 'refused';
      });

      // Eleven days later: both ran 7 days, ended 4 days ago; B's payment window opened a day ago.
      const AGE = 11;
      await sim.world.sql('UPDATE public.campaigns SET created_at = created_at - make_interval(days => $1) WHERE id IN ($2, $3)', [AGE, plain.id, scored.id]);
      await sim.world.sql('UPDATE public.campaign_joins SET joined_at = joined_at - make_interval(days => $1) WHERE campaign_id IN ($2, $3)', [AGE, plain.id, scored.id]);
      const startB = Date.parse(ok(await sim.world.rest('GET', '/campaigns?id=eq.' + scored.id + '&select=created_at'), 'b')[0].created_at);

      // Roles in B. Honest posters get distinct engagement counts, so the ranking is known
      // without running the scoring code. Three more test the gates.
      const verified = holders.filter((h) => h !== unverified);
      const [excluded, botOnly, dupe, ...honest] = rng.shuffle(verified);
      const counts = rng.shuffle(Array.from({ length: honest.length + 2 }, (_, i) => i + 1));
      const engagersFor = new Map();
      honest.forEach((h, i) => engagersFor.set(h.wallet, counts[i]));
      engagersFor.set(dupe.wallet, counts[honest.length]);
      engagersFor.set(excluded.wallet, counts[honest.length + 1] + 100);
      const postOf = new Map();
      let seq = 0;
      async function enterPost(h, handle, at, text) {
        seq += 1;
        const postId = snowflakeId(at, seq);
        ok(await sim.world.api('POST', '/api/campaigns/' + scored.id + '/score/posts', { posts: [{ post_id: postId, wallet: h.wallet, handle, text }] }, team.token), 'post for ' + h.label);
        return postId;
      }
      async function enterFans(postId, n, prefix) {
        const born = dayOnly(startB - 400 * DAY);
        const rows = Array.from({ length: n }, (_, j) => ({ handle: prefix + '_' + j, kind: 'reply', created_on: born, followers: 1000, following: 100 }));
        ok(await sim.world.api('POST', '/api/campaigns/' + scored.id + '/score/engagements', { post_id: postId, rows }, team.token), 'engagements on ' + postId);
      }

      await step('the team enters accounts, posts and engagement for B through the score API', async () => {
        const born = dayOnly(startB - 400 * DAY);
        const posters = verified.map((h) => ({ handle: h.handle, created_on: born, followers: 1000, following: 100 }));
        ok(await sim.world.api('POST', '/api/campaigns/' + scored.id + '/score/accounts', { accounts: posters }, team.token), 'accounts');
        let minute = 0;
        for (const h of [...honest, excluded, dupe]) {
          minute += 7;
          const at = startB + DAY + minute * 60000;
          const postId = await enterPost(h, h.handle, at, postText(rng));
          postOf.set(h.wallet, postId);
          await enterFans(postId, engagersFor.get(h.wallet), 'fan_' + minute);
        }
        // The same text again, later and with more engagement: dropped as a near duplicate.
        const firstText = ok(await sim.world.api('GET', '/api/campaigns/' + scored.id + '/score'), 'score').inputs.posts.find((p) => p.post_id === postOf.get(dupe.wallet)).text;
        const again = await enterPost(dupe, dupe.handle, startB + 2 * DAY, firstText);
        await enterFans(again, 50, 'dupfan');
        // Engagement only from accounts the team marks as bots.
        const botPost = await enterPost(botOnly, botOnly.handle, startB + 3 * DAY, postText(rng));
        await enterFans(botPost, 3, 'botfan');
        for (let j = 0; j < 3; j++) {
          ok(await sim.world.api('POST', '/api/campaigns/' + scored.id + '/score/overrides', { action: 'bot', handle: 'botfan_' + j, reason: 'sim: bot farm' }, team.token), 'bot override');
        }
        // A post for the holder without verified X.
        const ghost = await enterPost(unverified, 'ghost_' + unverified.label, startB + 4 * DAY, postText(rng));
        await enterFans(ghost, 40, 'ghostfan');
        ok(await sim.world.api('POST', '/api/campaigns/' + scored.id + '/score/overrides', { action: 'exclude_person', wallet: excluded.wallet, reason: 'sim: team excluded' }, team.token), 'exclude override');
        await refused(() => sim.world.api('POST', '/api/campaigns/' + scored.id + '/score/posts', { posts: [{ post_id: snowflakeId(startB - DAY, 99), wallet: honest[0].wallet, handle: honest[0].handle, text: 'before the start' }] }, team.token), /outside the campaign window/, 'a post before the start');
        // Re-entering a post edits it; it cannot move the post to another holder.
        const owner = honest[0];
        ok(await sim.world.api('POST', '/api/campaigns/' + scored.id + '/score/posts', { posts: [{ post_id: postOf.get(owner.wallet), wallet: honest[1].wallet, handle: honest[1].handle, text: postText(rng) }] }, team.token), 're-enter a post');
        const stored = ok(await sim.world.rest('GET', '/score_posts?post_id=eq.' + postOf.get(owner.wallet) + '&select=wallet,handle'), 'post')[0];
        checkEqual([stored.wallet, stored.handle], [owner.wallet, owner.handle], 'owner of a re-entered post');
        await refused(() => sim.world.api('POST', '/api/campaigns/' + scored.id + '/score/posts', { posts: [{ post_id: postOf.get(honest[0].wallet), wallet: honest[0].wallet, handle: honest[0].handle }] }, holders[0].token), /admin/, 'a holder entering posts');
        return honest.length + ' honest posters; plus excluded, bot-only, near-duplicate and unverified';
      });

      const board = await step('the public score ranks honest posters by engagement and zeroes the gated ones', async () => {
        const res = ok(await sim.world.api('GET', '/api/campaigns/' + scored.id + '/score'), 'score');
        const by = new Map(res.results.map((r) => [r.wallet, r]));
        const ranking = [...honest, dupe].sort((a, b) => engagersFor.get(b.wallet) - engagersFor.get(a.wallet));
        for (let i = 1; i < ranking.length; i++) {
          const hi = by.get(ranking[i - 1].wallet).score_milli;
          const lo = by.get(ranking[i].wallet).score_milli;
          const why = (h) => JSON.stringify({ gate: by.get(h.wallet).gate.reason, posts: by.get(h.wallet).posts.map((p) => [p.reason, p.T, p.engagers.length]) });
          check(hi > lo && lo > 0, ranking[i - 1].label + ' (' + hi + ') should outscore ' + ranking[i].label + ' (' + lo + ' ' + why(ranking[i]) + ')');
        }
        checkEqual([by.get(excluded.wallet).score_milli, by.get(excluded.wallet).excluded], [0, true], 'excluded holder');
        checkEqual(by.get(botOnly.wallet).score_milli, 0, 'bot-only holder');
        check(by.get(botOnly.wallet).posts[0].engagers.every((e) => e.class === 'bot' && e.weight === 0), 'bot engagers counted');
        checkEqual([by.get(unverified.wallet).score_milli, by.get(unverified.wallet).gate.reason], [0, 'unverified'], 'unverified holder');
        const dupePosts = by.get(dupe.wallet).posts;
        checkEqual(dupePosts.map((p) => p.reason), [null, 'near_duplicate'], 'near-duplicate posts');
        const anon = res.reasons;
        check(anon === undefined, 'reasons shown to an anonymous reader');
        return { ranking, detail: 'order ' + ranking.map((h) => labelOf(sim, h.wallet) + ':' + by.get(h.wallet).score_milli).join(' > ') + '; score hash ' + res.score_hash.slice(0, 12) };
      }).then((v) => v.ranking);

      await step('A pays the top 3 by hand points', async () => {
        await team.platform.updateCampaignStatus(plain.id, 'ended');
        const expected = expectedTop3(await joinRows(sim, plain.id), prizeA);
        await settle(sim, project, plain.id, {
          afterPropose: async (s) => {
            checkEqual(s.payouts.map((p) => [p.wallet, p.amountRaw]), expected.map((p) => [p.wallet, p.amountRaw]), 'A payouts');
            check(!s.score_hash && !s.score_inputs, 'A settlement carries a score');
          },
        });
        ctx.fact('aPaid', expected.map((p) => [labelOf(sim, p.wallet), p.amountRaw]));
        return 'paid ' + expected.map((p) => labelOf(sim, p.wallet)).join(', ');
      });

      await step('B pays the top 3 by score; its inputs are frozen once the payout is proposed', async () => {
        const shares = [50n, 30n, 20n];
        const expected = board.slice(0, 3).map((h, i) => [h.wallet, (prizeB * shares[i] / 100n).toString()]);
        const scoreNow = ok(await sim.world.api('GET', '/api/campaigns/' + scored.id + '/score'), 'score');
        await settle(sim, project, scored.id, {
          afterPropose: async (s) => {
            checkEqual(s.payouts.map((p) => [p.wallet, p.amountRaw]), expected, 'B payouts');
            checkEqual(s.score_hash, scoreNow.score_hash, 'locked score hash');
            await refused(() => sim.world.api('POST', '/api/campaigns/' + scored.id + '/score/engagements', { post_id: postOf.get(board[board.length - 1].wallet), rows: [{ handle: 'late_fan', kind: 'quote', created_on: dayOnly(startB - 400 * DAY), followers: 1000, following: 100 }] }, team.token), /frozen|payout/, 'entering engagement after the payout is proposed');
            await refused(() => sim.world.api('POST', '/api/campaigns/' + scored.id + '/score/overrides', { action: 'exclude_person', wallet: board[0].wallet, reason: 'late change' }, team.token), /frozen|payout/, 'an override after the payout is proposed');
          },
        });
        const receipt = ok(await sim.world.api('GET', '/api/campaigns/' + scored.id + '/receipt'), 'receipt');
        check(receipt.settlement.hash_recomputed_ok === true, 'B receipt is not verified');
        // What receipt.html does: hash the public inputs itself, rescore them, compare both.
        const after = ok(await sim.world.api('GET', '/api/campaigns/' + scored.id + '/score'), 'score after payout');
        const inputHash = hashScoreInputs(after.inputs, canonicalJson, (text) => createHash('sha256').update(text).digest('hex'));
        checkEqual(inputHash, scoreNow.score_hash, 'score inputs after the payout');
        const executed = after.settlements.find((x) => x.status === 'executed');
        checkEqual(executed && executed.score_hash, inputHash, 'executed settlement score hash');
        const note = recomputeScoreNote(after, scoreCampaign(after.inputs), inputHash);
        check(/^all \d+ scores match$/.test(note), 'receipt check says: ' + note);
        ctx.fact('bPaid', expected.map(([w, a]) => [labelOf(sim, w), a]));
        return 'paid ' + board.slice(0, 3).map((h) => labelOf(sim, h.wallet)).join(', ') + '; edits refused after propose; receipt check: ' + note;
      });

      await step('holders paid in both campaigns got both amounts, and nobody else got anything', async () => {
        const settlements = ok(await sim.world.rest('GET', '/vault_settlements?project_id=eq.' + project.id + '&status=eq.executed&select=payouts'), 'settlements');
        const owed = new Map();
        for (const s of settlements) for (const p of s.payouts) owed.set(p.wallet, (owed.get(p.wallet) || 0n) + BigInt(p.amountRaw));
        for (const h of holders) checkEqual(await sim.chain.tokenBalance(h.wallet, project.mint), owed.get(h.wallet) || 0n, 'tokens for ' + h.label);
        const both = holders.filter((h) => settlements.every((s) => s.payouts.some((p) => p.wallet === h.wallet)));
        return both.length + ' holder(s) paid by both campaigns; balances match';
      });
    } finally {
      await closeSim(sim);
    }
  },
};
