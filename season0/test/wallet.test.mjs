import test from 'node:test';
import assert from 'node:assert/strict';
import { phantomBrowseUrl, solflareBrowseUrl, wrongNetworkHelp, looksLikeMainnet } from '../ui/wallet.js';
import { mirrorLinks } from '../lib/statefile.js';

const page = 'https://bard.is/play/';
const ref = 'https://bard.is';

test('Phantom and Solflare browse links use the verified shapes', () => {
  assert.equal(
    phantomBrowseUrl(page, ref),
    'https://phantom.com/ul/browse/' + encodeURIComponent(page) + '?ref=' + encodeURIComponent(ref)
  );
  assert.equal(
    solflareBrowseUrl(page, ref),
    'https://solflare.com/ul/v1/browse/' + encodeURIComponent(page) + '?ref=' + encodeURIComponent(ref)
  );
});

test('wrong-network help is specific to the connected wallet', () => {
  assert.match(wrongNetworkHelp('phantom').title, /may be on mainnet/);
  assert.match(wrongNetworkHelp('phantom').steps, /Developer Settings/);
  assert.match(wrongNetworkHelp('solflare').steps, /General > Network > Devnet/);
  assert.match(wrongNetworkHelp('backpack').steps, /Developer Mode/);
  assert.match(wrongNetworkHelp('other').steps, /switch the network to Solana Devnet/);
  assert.equal(looksLikeMainnet('blockhash not found'), false);
  assert.equal(looksLikeMainnet('Transaction simulation failed on mainnet-beta'), true);
});

test('verify links name Supabase and the GitHub mirror, and the hashes match', () => {
  const links = mirrorLinks({
    memo: 'bard:v1:state:s0:3:' + 'a'.repeat(64),
    hash: 'a'.repeat(64),
    supabasePath: 'season-state/s0-chapter-3.json'
  }, 'https://example.supabase.co');
  assert.equal(links.supabaseUrl, 'https://example.supabase.co/storage/v1/object/public/season-state/s0-chapter-3.json');
  assert.equal(links.matches, true);
  assert.equal(links.supabaseUrl.includes('pxdiyukxgnphxlknhmke'), false);
});
