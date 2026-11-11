/**
 * Scenario 4. Proof approval: holders send a tweet link as proof. Some are real tweet links,
 * some are not (another site, a profile, a script URL, junk). The team reviews the proof,
 * approves the valid tweets and rejects the rest; rejected holders earn nothing.
 *
 * Raid, the type that showed proof links, is not offered. A custom campaign stores the link,
 * so the holder side is driven through platform.js; whether the team can see it is checked.
 */
import { check, checkEqual, ok } from '../lib/harness.mjs';
import {
  openSim, closeSim, makeTeam, makeHolders, launchProject, createCampaign,
  expectedLock, joinRows, settle, human, labelOf,
} from '../lib/journey.mjs';
import { expectedFixed } from '../lib/expect.mjs';

const TWEET = /^https:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{5,25}$/;

function proofFor(rng, i) {
  const kinds = ['tweet', 'tweet', 'twitter', 'site', 'profile', 'script', 'junk', 'none'];
  const kind = i === 0 ? 'tweet' : i === 1 ? 'script' : rng.pick(kinds);
  const handle = 'holder' + i;
  const id = String(1800000000000000000n + BigInt(rng.int(1, 1e9)));
  if (kind === 'tweet') return { kind, url: 'https://x.com/' + handle + '/status/' + id, valid: true };
  if (kind === 'twitter') return { kind, url: 'https://twitter.com/' + handle + '/status/' + id, valid: true };
  if (kind === 'site') return { kind, url: 'https://example.com/' + handle + '/status/' + id, valid: false };
  if (kind === 'profile') return { kind, url: 'https://x.com/' + handle, valid: false };
  if (kind === 'script') return { kind, url: 'javascript:alert(document.cookie)', valid: false };
  if (kind === 'junk') return { kind, url: 'look at my tweet', valid: false };
  return { kind, url: null, valid: false };
}

export default {
  id: 's4',
  name: 'Proof approval: valid and invalid tweet proofs',
  async run(ctx) {
    const { rng, step } = ctx;
    let sim;
    try {
      sim = await openSim(ctx);
      const decimals = 6;
      const unit = 10n ** 6n;
      const each = BigInt(rng.int(1, 9)) * unit;
      const slots = 6;
      const lock = expectedLock(each * BigInt(slots), 500n);
      const team = await step('team signs in', async () => makeTeam(sim, 'team'));
      const project = await step('launch the project', async () => {
        const p = await launchProject(sim, team, { name: 'Proof Project', ticker: 'PRF', decimals, depositRaw: lock.lockedRaw });
        return { p, detail: 'locked room for ' + slots + ' × ' + human(each, decimals) };
      }).then((v) => v.p);
      const campaign = await step('create a custom campaign that asks for a tweet link, with approval', async () => {
        const c = await createCampaign(sim, project, { title: 'Post about us', type: 'custom', rule: 'Post a tweet and send its link.', rewardMode: 'fixed', reward: human(each, decimals), config: { holderCount: String(slots) }, accessMode: 'approval', days: 7 });
        return { c, detail: 'custom, approval, ' + slots + ' × ' + human(each, decimals) };
      }).then((v) => v.c);

      const holders = await step('holders join with their proof links', async () => {
        const list = await makeHolders(sim, ctx.holderCount(6, 30));
        list.forEach((h, i) => { h.proof = proofFor(rng, i); });
        for (const h of list) await h.platform.joinCampaign(project.id, campaign.id, h.wallet, null, false, h.proof.url, null, null);
        const kinds = {};
        for (const h of list) kinds[h.proof.kind] = (kinds[h.proof.kind] || 0) + 1;
        return { list, detail: Object.entries(kinds).map(([k, n]) => n + ' ' + k).join(', ') };
      }).then((v) => v.list);

      await step('stored proof: http(s) links are kept, a script URL and junk are dropped', async () => {
        const rows = await joinRows(sim, campaign.id);
        const by = new Map(rows.map((r) => [r.wallet, r]));
        for (const h of holders) {
          const stored = by.get(h.wallet).evidence_url;
          const keep = h.proof.url && /^https?:\/\//.test(h.proof.url);
          checkEqual(stored || null, keep ? h.proof.url : null, 'evidence for ' + labelOf(sim, h.wallet) + ' (' + h.proof.kind + ')');
        }
        return 'stored as expected';
      });

      await step('a script URL written straight to the database is never shown as a link', async () => {
        const h = holders[1];
        const direct = await sim.world.rest('PATCH', '/campaign_joins?campaign_id=eq.' + campaign.id + '&wallet=eq.' + h.wallet, { evidence_url: 'javascript:alert(1)' }, h.token);
        check(direct.status < 500, 'database error ' + direct.status);
        const safe = team.platform.safeHttpUrl('javascript:alert(1)');
        checkEqual(safe, '', 'safeHttpUrl of a script URL');
        return 'stored text only (status ' + direct.status + '); the review screen renders it through safeHttpUrl';
      });

      await step('the team sees each holder\'s proof link in the review queue', async () => {
        const queue = await team.platform.fetchJoinQueue(campaign.id);
        const shown = queue.joins.filter((j) => j.evidence && j.evidence.post_url).length;
        const sent = holders.filter((h) => h.proof.url && /^https?:\/\//.test(h.proof.url)).length;
        checkEqual(shown, sent, 'proof links in the team queue');
        return shown + ' links shown';
      });

      const valid = holders.filter((h) => h.proof.valid && h.proof.url && TWEET.test(h.proof.url));
      const approved = valid.slice(0, slots);
      const rejected = holders.filter((h) => !approved.includes(h));
      await step('the team approves valid tweet proofs and rejects the rest', async () => {
        // The team reads the stored link from the join row, the way the review screen does.
        const rows = await joinRows(sim, campaign.id);
        for (const row of rows) {
          const ok = row.evidence_url && TWEET.test(row.evidence_url) && approved.some((h) => h.wallet === row.wallet);
          await team.platform.setJoinStatus(campaign.id, row.wallet, ok ? 'approved' : 'rejected');
          if (ok) await team.platform.setJoinProgress(campaign.id, row.wallet, 1 + rng.int(0, 9), 'proof ok');
          else await team.platform.setJoinProgress(campaign.id, row.wallet, 50, 'proof refused');
        }
        const after = await joinRows(sim, campaign.id);
        checkEqual(after.filter((r) => r.status === 'approved').length, approved.length, 'approved count');
        return approved.length + ' approved, ' + rejected.length + ' rejected (rejected were given more points on purpose)';
      });

      await step('only approved proofs are paid', async () => {
        await team.platform.updateCampaignStatus(campaign.id, 'ended');
        const rows = await joinRows(sim, campaign.id);
        const expected = expectedFixed(rows, each, each * BigInt(slots));
        checkEqual(new Set(expected.map((p) => p.wallet)), new Set(approved.map((h) => h.wallet)), 'paid set');
        const done = await settle(sim, project, campaign.id, {
          afterPropose: async (s) => checkEqual(s.payouts.map((p) => [p.wallet, p.amountRaw]), expected.map((p) => [p.wallet, p.amountRaw]), 'payouts'),
        });
        for (const h of rejected) checkEqual(await sim.chain.tokenBalance(h.wallet, project.mint), 0n, 'tokens for rejected ' + labelOf(sim, h.wallet));
        ctx.fact('paid', expected.map((p) => labelOf(sim, p.wallet)));
        return expected.length + ' paid; tx ' + done.signature.slice(0, 8) + '…';
      });
    } finally {
      await closeSim(sim);
    }
  },
};
