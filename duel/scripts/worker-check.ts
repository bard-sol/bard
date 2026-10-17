/**
 * Plays one full match against the hosted pilot and checks the public boundary.
 * Run against `wrangler dev`. PASSCODE comes from the environment, not the repo.
 */
import { scriptedAction, sleep } from '../tests/support.ts';
import type { ClientPayload, MarginaliaView } from '../src/types.ts';

const base = process.env.DUEL_URL ?? 'http://127.0.0.1:8788';
const passcode = process.env.PASSCODE ?? '';
const planted = 'client-supplied-seed-should-never-be-used-0001';
const forbidden = new Set(['seed', 'rng', 'deck', 'decks', 'deckA', 'deckB', 'tiebreak', 'players', 'state', 'log', 'setup']);

function redact(text: string): string {
  return passcode ? text.split(passcode).join('[passcode]') : text;
}

function fail(message: string): never {
  throw new Error(message);
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, { redirect: 'manual', ...init });
}

function cookieHeader(response: Response): string {
  const set = response.headers.get('set-cookie') ?? '';
  const match = set.match(/bard_duel_session=([^;]+)/);
  if (!match) fail(`unlock did not set a session cookie: ${redact(set)}`);
  if (!set.includes('HttpOnly')) fail('session cookie is missing HttpOnly');
  if (!set.includes('Max-Age=2592000')) fail(`session cookie is not 30 days: ${redact(set)}`);
  if (!set.includes('SameSite=Lax')) fail('session cookie is missing SameSite=Lax');
  return `bard_duel_session=${match[1]}`;
}

function assertRobots(response: Response, label: string): void {
  const tag = response.headers.get('x-robots-tag') ?? '';
  if (!tag.includes('noindex') || !tag.includes('nofollow') || !tag.includes('noarchive')) {
    fail(`${label} missing noindex header: ${tag}`);
  }
}

function assertSafe(body: unknown, label: string): void {
  const text = JSON.stringify(body);
  if (text.includes(planted)) fail(`${label} echoed the planted seed`);
  walk(body, label);
  const payload = body as ClientPayload;
  for (const page of payload.view?.pages ?? []) {
    for (const note of page.marginalia ?? []) assertNote(note, text, label);
  }
}

function assertNote(note: MarginaliaView, text: string, label: string): void {
  if (note.known !== false) return;
  if (note.name || note.text) fail(`${label} named a face-down note`);
  if (!note.instanceId.startsWith('sealed-')) fail(`${label} face-down note was not sealed`);
  const rawNote = note as MarginaliaView & { defId?: string };
  if (rawNote.defId) fail(`${label} face-down note carried a def id`);
  if (text.includes('"defId"') && text.includes(note.instanceId) && rawNote.defId) fail(`${label} sealed note identity`);
}

function walk(value: unknown, label: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, label);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (forbidden.has(key)) fail(`${label} contained forbidden key ${key}`);
    walk(entry, label);
  }
}

async function main(): Promise<void> {
  if (!passcode) fail('PASSCODE is not set');

  const robots = await raw('/robots.txt');
  assertRobots(robots, 'robots');
  const robotsBody = await robots.text();
  if (robotsBody !== 'User-agent: *\nDisallow: /\n') fail(`robots.txt was ${JSON.stringify(robotsBody)}`);

  const locked = await raw('/api/health');
  assertRobots(locked, 'locked health');
  if (locked.status !== 401) fail(`locked API status ${locked.status}`);

  const gate = await raw('/');
  assertRobots(gate, 'gate');
  const gateHtml = await gate.text();
  if (gate.status !== 200 || !gateHtml.includes('action="/api/unlock"') || gateHtml.includes('/assets/')) {
    fail('gate did not replace the client');
  }

  const wrong = await raw('/api/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passcode: `${passcode}-no` }),
  });
  if (wrong.status !== 401) fail(`wrong passcode status ${wrong.status}`);
  if (wrong.headers.get('set-cookie')) fail('wrong passcode set a cookie');

  const unlocked = await raw('/api/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });
  assertRobots(unlocked, 'unlock');
  if (unlocked.status !== 200) fail(`unlock status ${unlocked.status} ${redact(await unlocked.text())}`);
  const cookie = cookieHeader(unlocked);
  const auth = { cookie };

  const home = await raw('/', { headers: auth });
  assertRobots(home, 'client');
  const homeHtml = await home.text();
  if (home.status !== 200 || !homeHtml.includes('/assets/')) fail('authenticated client was not served');

  const health = await raw('/api/health', { headers: auth });
  if (health.status !== 200) fail(`health ${health.status}`);

  const created = await raw('/api/matches', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      playerDeckId: 'candle',
      opponentDeckId: 'fold',
      stance: 'patient',
      seed: planted,
    }),
  });
  assertRobots(created, 'create');
  if (created.status !== 201) fail(`create ${created.status} ${redact(await created.text())}`);
  let payload = (await created.json()) as ClientPayload;
  assertSafe(payload, 'create');
  if (payload.secondInkTurns !== 1) fail('secondInkTurns missing');
  if (payload.engineVersion !== 'duel-engine-1.3.0') fail(`engine ${payload.engineVersion}`);
  if (payload.cardsVersion !== 'cards-proto-1.3') fail(`cards ${payload.cardsVersion}`);
  if (payload.aiVersion !== 'pilot-1.3.0') fail(`ai ${payload.aiVersion}`);
  if (payload.rulesVersion !== 'rules-1.3.0') fail(`rules ${payload.rulesVersion}`);
  if (payload.secondVerse !== 1) fail(`secondVerse ${payload.secondVerse}`);

  const denied = await raw(`/api/matches/${payload.matchId}?player=1`, { headers: auth });
  if (denied.status !== 403) fail(`player=1 status ${denied.status}`);
  assertSafe(await denied.json(), 'player=1');

  const illegal = await raw(`/api/matches/${payload.matchId}/actions`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ action: { type: 'end' } }),
  });
  if (illegal.status !== 400 && illegal.status !== 403) fail(`illegal status ${illegal.status}`);
  assertSafe(await illegal.json(), 'illegal');

  let previewed = false;
  let sawPilot = payload.opponentThinking;
  for (let guard = 0; guard < 400 && payload.view.winner == null; guard++) {
    const waited = await waitForTurn(payload, auth.cookie);
    payload = waited.payload;
    if (waited.sawPilot) sawPilot = true;
    if (payload.view.winner != null) break;
    const action = scriptedAction(payload);
    if (!previewed && action.type === 'attack') {
      const preview = await raw(`/api/matches/${payload.matchId}/preview`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (preview.status !== 200) fail(`preview ${preview.status} ${redact(await preview.text())}`);
      assertSafe(await preview.json(), 'preview');
      previewed = true;
    }
    const acted = await raw(`/api/matches/${payload.matchId}/actions`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (acted.status !== 200) fail(`action ${acted.status} ${redact(await acted.text())} ${action.type}`);
    payload = (await acted.json()) as ClientPayload;
    assertSafe(payload, 'action');
    if (payload.opponentThinking) sawPilot = true;
  }
  if (payload.view.winner == null) fail('match did not finish');
  if (!sawPilot) fail('pilot never took a turn');

  const verified = await raw(`/api/matches/${payload.matchId}/replay-verify`, { method: 'POST', headers: auth });
  if (verified.status !== 200) fail(`replay ${verified.status} ${redact(await verified.text())}`);
  const report = (await verified.json()) as {
    ok: boolean;
    mismatches: string[];
    engineVersion: string;
    cardsVersion: string;
    aiVersion: string;
    rulesVersion: string;
    secondInkTurns: number;
    secondVerse: number;
    seed?: unknown;
  };
  assertSafe(report, 'replay');
  if (!report.ok) fail(`replay mismatches ${report.mismatches.join(',')}`);
  if (report.secondInkTurns !== 1) fail('replay dropped secondInkTurns');
  if (report.engineVersion !== 'duel-engine-1.3.0' || report.cardsVersion !== 'cards-proto-1.3') fail('replay versions');
  if (report.aiVersion !== 'pilot-1.3.0' || report.rulesVersion !== 'rules-1.3.0') fail('replay ai/rules');
  if (report.secondVerse !== 1) fail('replay dropped secondVerse');
  if ('seed' in report) fail('replay included a seed key');
  console.log(`worker check ok winner=${payload.view.winner} preview=${previewed}`);
}

async function waitForTurn(payload: ClientPayload, cookie: string): Promise<{ payload: ClientPayload; sawPilot: boolean }> {
  let current = payload;
  let sawPilot = false;
  const start = Date.now();
  while (current.view.winner == null && !current.view.yourTurn) {
    sawPilot = true;
    if (Date.now() - start > 20_000) fail('pilot turn timed out');
    await sleep(50);
    const response = await raw(`/api/matches/${current.matchId}`, { headers: { cookie } });
    if (response.status !== 200) fail(`poll ${response.status} ${redact(await response.text())}`);
    current = (await response.json()) as ClientPayload;
    assertSafe(current, 'poll');
  }
  return { payload: current, sawPilot };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'worker check failed';
  console.error(redact(message));
  process.exit(1);
});
