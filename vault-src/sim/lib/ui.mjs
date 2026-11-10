/**
 * Browser checks for the pages where the page is the journey (the public campaign page, the
 * join button, the receipt). Chromium loads the pages from the simulated worker; the page's
 * requests to the production Supabase project are answered by the local database inside this
 * process, and anything else outside this machine is refused.
 */
import nacl from 'tweetnacl';
import { chromium } from '@playwright/test';
import { PROD_SUPABASE_HOST, violations } from './world.mjs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
  'access-control-expose-headers': '*',
};

export async function createBrowser() {
  // BARD_SIM_CHROMIUM points at a Chromium (or a wrapper that sets its library path) on machines
  // where Playwright's own build cannot start.
  const executablePath = process.env.BARD_SIM_CHROMIUM || undefined;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath });
  } catch (err) {
    throw new Error('Chromium did not start (' + String(err && err.message || err).split('\n')[0]
      + '). Run npx playwright install chromium, set BARD_SIM_CHROMIUM, or pass --no-ui.');
  }
  return {
    /**
     * A page in a fresh profile. `keypair`, when given, is the wallet the page sees as
     * window.solana / window.phantom.solana; signMessage signs with it in this process.
     */
    async page(world, keypair) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.route('**/*', async (route) => {
        const req = route.request();
        let url;
        try { url = new URL(req.url()); } catch { await route.abort('failed'); return; }
        if (url.origin === world.base) { await route.continue(); return; }
        if (url.hostname === PROD_SUPABASE_HOST) {
          if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: CORS, body: '' }); return; }
          const body = req.postDataBuffer();
          const res = await world.browserFetch(new Request(url.toString(), {
            method: req.method(),
            headers: req.headers(),
            body: body && req.method() !== 'GET' && req.method() !== 'HEAD' ? body : undefined,
          }));
          const headers = { ...CORS };
          res.headers.forEach((v, k) => { headers[k] = v; });
          await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
          return;
        }
        const type = req.resourceType();
        if (type === 'stylesheet' || type === 'font' || type === 'image') {
          await route.fulfill({ status: 200, contentType: type === 'stylesheet' ? 'text/css' : 'application/octet-stream', body: '' });
          return;
        }
        violations.push({ at: new Date().toISOString(), url: req.url().slice(0, 200), reason: 'browser: host is outside the simulation' });
        await route.abort('failed');
      });
      if (keypair) {
        const wallet = keypair.publicKey.toBase58();
        await page.exposeFunction('__simSign', (bytes) => Array.from(nacl.sign.detached(Uint8Array.from(bytes), keypair.secretKey)));
        await page.addInitScript((w) => {
          const publicKey = { toString: () => w, toBase58: () => w };
          const wallet = {
            isPhantom: true,
            publicKey,
            isConnected: true,
            async connect() { return { publicKey }; },
            async disconnect() {},
            async signMessage(bytes) {
              const sig = await window.__simSign(Array.from(bytes));
              return { signature: Uint8Array.from(sig), publicKey };
            },
            on() {},
            off() {},
          };
          window.solana = wallet;
          window.phantom = { solana: wallet };
        }, wallet);
      }
      return {
        page,
        errors,
        async close() { await context.close(); },
      };
    },
    async close() {
      await browser.close();
    },
  };
}
