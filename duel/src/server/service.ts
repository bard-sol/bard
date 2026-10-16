import { actorOf, buildSetup, deckError, IllegalActionError, recordedBundle, sameAction } from '../engine/adapter.js';
import { applyScoreNotes, collectScoreNotes } from '../engine/scores.js';
import type { EngineState } from '../engine/state.js';
import { scriptedTutorialTurn, TUTORIAL_SEED, tutorialDecks } from '../tutorial/script.js';
import type { ClientPayload, Deck, EngineAdapter, GameAction, PlayerId, PlayerView, Stance, TradePreview } from '../types.js';
import { assertClientSafe } from './redact.js';
import { FRIEND_CODE } from './session.js';
import type { LogEntry, MatchRecord, MatchRepository } from './store.js';

export const DEFAULT_TURN_MS = 35_000;
export const DEFAULT_AI_TURN_MS = 5_000;
export const MULLIGAN_MS = 20_000;
const EARLY_MATCH_TURN_MS = 60_000;
const EARLY_MATCHES = 3;
const MISS_LIMIT = 3;

export interface CreateMatchInput {
  decks: readonly [Deck, Deck];
  stance: Stance;
  /** Server tests inject a uint32. The HTTP API never forwards one. */
  seed?: number;
  /**
   * Durable Object matches pass the id that was used with `getByName`.
   * Express leaves this empty and the service draws a UUID.
   */
  id?: string;
  /** Guided first match. The service forces the scripted seed and decks. */
  tutorial?: boolean;
  /** Real matches already finished on this session. The first three use a 60s turn. */
  matchesPlayed?: number;
  /** When set, this match uses this turn length and skips the first-three-matches rule. */
  humanTurnMs?: number;
  /** Both seats are human. Seat order still comes from the engine seed. */
  friend?: { sessions: [string, string]; deckIds: [string, string] };
}

/** Replaces `setTimeout` where the process may be evicted (Durable Object alarms). */
export interface ClockRequest {
  kind: 'human' | 'pilot';
  token: number;
  delayMs: number;
}

export interface TimerBridge {
  arm(clock: ClockRequest): void;
  disarm(): void;
}

export interface ReplayReport {
  ok: boolean;
  actionCount: number;
  mismatches: string[];
  engineVersion: string;
  cardsVersion: string;
  aiVersion: string;
  rulesVersion: string;
  secondInkTurns: number;
  secondVerse: number;
}

type Ok<T> = { ok: true; payload: T };
type Err = { ok: false; error: 'not_found' | 'illegal_action' | 'opponent_turn' | 'forbidden_view' | 'bad_deck' };
export type ServiceResult<T> = Ok<T> | Err;

export interface PilotPlan {
  expectedGen: number;
  actions: GameAction[];
  next: number;
  step: number;
}

export class MatchService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly plans = new Map<string, PilotPlan>();
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: MatchRepository,
    private readonly adapter: EngineAdapter,
    private readonly options: { turnTimeoutMs?: number; aiTurnMs?: number; onChange?: (id: string) => void } = {},
    private readonly clock?: TimerBridge,
  ) {}

  get turnTimeoutMs(): number {
    return this.options.turnTimeoutMs ?? DEFAULT_TURN_MS;
  }

  get aiTurnMs(): number {
    return this.options.aiTurnMs ?? DEFAULT_AI_TURN_MS;
  }

  async create(input: CreateMatchInput): Promise<ServiceResult<ClientPayload>> {
    const tutorial = input.tutorial === true;
    const decks = tutorial ? tutorialDecks() : input.decks;
    const stance: Stance = tutorial ? 'patient' : input.stance;
    const invalid = validateDecks(decks);
    if (invalid) return { ok: false, error: 'bad_deck' };
    const id = isServerId(input.id) ? input.id : crypto.randomUUID();
    const seed = tutorial ? TUTORIAL_SEED : input.seed != null ? input.seed >>> 0 : randomSeed();
    const setup = buildSetup(decks, seed, this.adapter);
    let state: EngineState;
    try {
      state = this.adapter.initialState(decks, setup.seed);
    } catch {
      return { ok: false, error: 'bad_deck' };
    }
    const match: MatchRecord = {
      id,
      setup,
      stance,
      state,
      log: [],
      generation: 0,
      turnToken: 0,
      thinking: false,
      deadline: null,
      createdAt: new Date().toISOString(),
      tutorial,
      humanTurnMs: input.humanTurnMs ?? (tutorial ? 0 : input.matchesPlayed == null ? this.turnTimeoutMs : input.matchesPlayed < EARLY_MATCHES ? EARLY_MATCH_TURN_MS : this.turnTimeoutMs),
      friend: input.friend
        ? { sessions: input.friend.sessions, deckIds: input.friend.deckIds, misses: [0, 0], forfeitedBy: null, rematchCode: null }
        : undefined,
    };
    await this.lock(id, async () => {
      if (tutorial) this.finishMulligans(match);
      this.syncClock(match);
      await this.repo.put(match);
      this.note(match);
    });
    return { ok: true, payload: this.toClient(match) };
  }

  async get(id: string, player: PlayerId = 0): Promise<ServiceResult<ClientPayload>> {
    const match = await this.repo.get(id);
    if (!match) return { ok: false, error: 'not_found' };
    if (!this.allows(match, player)) return { ok: false, error: 'forbidden_view' };
    return { ok: true, payload: this.toClient(match, player) };
  }

  async seatForId(id: string, session: string | null): Promise<PlayerId | null> {
    if (!session) return null;
    const match = await this.repo.get(id);
    if (!match?.friend) return null;
    if (match.friend.sessions[0] === session) return 0;
    if (match.friend.sessions[1] === session) return 1;
    return null;
  }

  async isFriend(id: string): Promise<boolean> {
    const match = await this.repo.get(id);
    return Boolean(match?.friend);
  }

  async rematchCode(id: string): Promise<string | null> {
    const match = await this.repo.get(id);
    const code = match?.friend?.rematchCode;
    return code && code !== 'pending' ? code : null;
  }

  /** The seated pair, once the match is over. Pending rematches stay on the record. */
  async friendSeed(id: string): Promise<{ sessions: [string, string]; deckIds: [string, string]; turnMs: number } | null> {
    const match = await this.repo.get(id);
    if (!match?.friend || !friendOver(match)) return null;
    return { sessions: match.friend.sessions, deckIds: match.friend.deckIds, turnMs: match.humanTurnMs ?? this.turnTimeoutMs };
  }

  async markRematch(id: string, code: string): Promise<boolean> {
    return this.lock(id, async () => {
      const match = await this.repo.get(id);
      if (!match?.friend) return false;
      match.friend.rematchCode = code.length > 0 ? code : null;
      match.generation += 1;
      await this.repo.put(match);
      this.note(match);
      return true;
    });
  }

  async act(id: string, player: PlayerId, action: GameAction): Promise<ServiceResult<ClientPayload>> {
    return this.lock(id, async () => {
      const match = await this.repo.get(id);
      if (!match) return { ok: false, error: 'not_found' };
      if (!this.allows(match, player)) return { ok: false, error: 'forbidden_view' };
      if (match.friend?.forfeitedBy != null) return { ok: false, error: 'illegal_action' };
      if (match.thinking || actorOf(match.state) !== player) return { ok: false, error: 'opponent_turn' };
      const played = action.type === 'end' && match.state.phase === 'mulligan' ? { type: 'mulligan' as const, idx: [] } : action;
      if (match.friend && !this.adapter.legalActions(match.state, player).some((item) => sameAction(item, played))) {
        return { ok: false, error: 'illegal_action' };
      }
      const applied = this.applyLogged(match, played, 'human');
      if (!applied) return { ok: false, error: 'illegal_action' };
      if (match.friend) match.friend.misses[player] = 0;
      this.syncClock(match);
      await this.repo.put(match);
      this.note(match);
      return { ok: true, payload: this.toClient(match, player) };
    });
  }

  async preview(id: string, player: PlayerId, action: GameAction): Promise<ServiceResult<{ matchId: string; preview: TradePreview }>> {
    const match = await this.repo.get(id);
    if (!match) return { ok: false, error: 'not_found' };
    if (!this.allows(match, player)) return { ok: false, error: 'forbidden_view' };
    if (match.thinking || actorOf(match.state) !== player || match.friend?.forfeitedBy != null) return this.quietPreview(id, match, player);
    try {
      const preview = this.adapter.previewAction(match.state, player, action);
      const payload = { matchId: id, preview };
      assertClientSafe(payload, match, player);
      return { ok: true, payload };
    } catch (error) {
      if (error instanceof IllegalActionError) return this.quietPreview(id, match, player);
      throw error;
    }
  }

  /** A preview that lost the race with a committed action. No error status, no hidden ids. */
  private quietPreview(id: string, match: MatchRecord, viewer: PlayerId): ServiceResult<{ matchId: string; preview: TradePreview }> {
    const preview: TradePreview = {
      attackerId: '',
      defenderId: '',
      attackerName: '',
      defenderName: '',
      attackerHealthBefore: 0,
      defenderHealthBefore: 0,
      attackerHealthAfter: 0,
      defenderHealthAfter: 0,
      attackerDies: false,
      defenderDies: false,
      verseGain: 0,
      marginNoteStrikes: false,
      units: [],
      deaths: [],
      conquer: false,
      noteMayFire: false,
      footnote: null,
    };
    const payload = { matchId: id, preview };
    assertClientSafe(payload, match, viewer);
    return { ok: true, payload };
  }

  async replayVerify(id: string): Promise<ServiceResult<ReplayReport>> {
    const match = await this.repo.get(id);
    if (!match) return { ok: false, error: 'not_found' };
    const mismatches: string[] = [];
    const recorded = recordedBundle(match.setup.engineVersion);
    if (!recorded) mismatches.push('engine_version');
    else {
      if (match.setup.cardsVersion !== recorded.cardsVersion) mismatches.push('cards_version');
      if (match.setup.aiVersion !== recorded.aiVersion) mismatches.push('ai_version');
      if (match.setup.rulesVersion !== recorded.rulesVersion) mismatches.push('rules_version');
      if (match.setup.rules.secondInkTurns !== recorded.secondInkTurns) mismatches.push('second_ink');
      if ((match.setup.rules.secondVerse ?? 0) !== recorded.secondVerse) mismatches.push('second_verse');
    }
    if (match.state.v !== match.setup.engineVersion) mismatches.push('state_engine');

    if (mismatches.length === 0) {
      try {
        const replayed = this.adapter.replay(match.setup, match.log.map((entry) => entry.action));
        if (this.adapter.stateHash(replayed) !== this.adapter.stateHash(match.state)) mismatches.push('engine_replay');
      } catch {
        mismatches.push('engine_replay');
      }
    }

    if (mismatches.length === 0) {
      let state = this.adapter.replay(match.setup, []);
      for (let i = 0; i < match.log.length; i++) {
        const entry = match.log[i];
        if (!entry) break;
        const actor = actorOf(state);
        if (actor !== entry.actor) {
          mismatches.push(`actor_${i}`);
          break;
        }
        if (entry.source === 'pilot') {
          const expected = this.adapter.pilot(state, match.stance);
          if (!sameAction(expected, entry.action)) {
            mismatches.push(`pilot_${i}`);
            break;
          }
        }
        try {
          state = this.adapter.apply(state, entry.action);
        } catch {
          mismatches.push(`apply_${i}`);
          break;
        }
      }
      if (mismatches.length === 0 && this.adapter.stateHash(state) !== this.adapter.stateHash(match.state)) mismatches.push('final_state');
    }

    if (mismatches.length === 0) {
      const pure = this.replayPure(match);
      if (pure.mismatch) mismatches.push(pure.mismatch);
      else if (pure.state && this.adapter.stateHash(pure.state) !== this.adapter.stateHash(match.state)) mismatches.push('pure_replay');
    }

    const payload: ReplayReport = {
      ok: mismatches.length === 0,
      actionCount: match.log.length,
      mismatches,
      engineVersion: match.setup.engineVersion,
      cardsVersion: match.setup.cardsVersion,
      aiVersion: match.setup.aiVersion,
      rulesVersion: match.setup.rulesVersion,
      secondInkTurns: match.setup.rules.secondInkTurns,
      secondVerse: match.setup.rules.secondVerse ?? 0,
    };
    assertClientSafe(payload, match, 0);
    return { ok: true, payload };
  }

  /** Restore a pilot plan loaded from Durable Object storage. */
  installPlan(id: string, plan: PilotPlan | null): void {
    if (!plan) this.plans.delete(id);
    else this.plans.set(id, plan);
  }

  exportPlan(id: string): PilotPlan | null {
    return this.plans.get(id) ?? null;
  }

  /** Alarm entry. `token` is the human turn token; pilot steps follow the stored plan. */
  fireClock(id: string, kind: ClockRequest['kind'], token: number): Promise<void> {
    if (kind === 'human') return this.onTimeout(id, token);
    return this.stepPilot(id);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.plans.clear();
    this.clock?.disarm();
  }

  private replayPure(match: MatchRecord): { state?: EngineState; mismatch?: string } {
    let state = this.adapter.replay(match.setup, []);
    let cursor = 0;
    for (let guard = 0; guard < 5000 && actorOf(state) != null; guard++) {
      const actor = actorOf(state);
      const next = match.log[cursor];
      if (!next) return { mismatch: 'missing_player_action' };
      if (next.actor !== actor) return { mismatch: `actor_${cursor}` };
      if (next.source === 'pilot') {
        const expected = this.adapter.pilot(state, match.stance);
        if (!sameAction(expected, next.action)) return { mismatch: `pilot_${cursor}` };
      }
      try {
        state = this.adapter.apply(state, next.action);
      } catch {
        return { mismatch: 'pure_apply' };
      }
      cursor += 1;
    }
    if (cursor !== match.log.length) return { mismatch: 'unconsumed_actions' };
    return { state };
  }

  /** Both seats keep their opening hands before the guided board is shown. */
  private finishMulligans(match: MatchRecord): void {
    for (let guard = 0; guard < 4 && match.state.phase === 'mulligan'; guard++) {
      if (!this.applyLogged(match, { type: 'mulligan', idx: [] }, 'script')) break;
    }
  }

  private applyLogged(match: MatchRecord, action: GameAction, source: LogEntry['source']): boolean {
    const actor = actorOf(match.state);
    if (actor == null) return false;
    try {
      match.state = this.adapter.apply(match.state, action);
    } catch (error) {
      if (error instanceof IllegalActionError) return false;
      throw error;
    }
    match.log.push({ index: match.log.length, actor, source, action });
    match.generation += 1;
    return true;
  }

  private syncClock(match: MatchRecord, depth = 0): void {
    const actor = actorOf(match.state);
    if (match.friend?.forfeitedBy != null || actor == null) {
      this.clearTimer(match.id);
      this.plans.delete(match.id);
      match.thinking = false;
      match.deadline = null;
      return;
    }
    if (actor === 1 && !match.friend) {
      this.clearTimer(match.id);
      match.turnToken += 1;
      this.startPilot(match, depth);
      return;
    }
    if (match.tutorial) {
      this.clearTimer(match.id);
      this.plans.delete(match.id);
      match.thinking = false;
      match.deadline = null;
      return;
    }
    const leftMulligan = match.clockPhase === 'mulligan' && match.state.phase !== 'mulligan';
    const seatChanged = match.clockSeat !== actor;
    if (match.deadline == null || match.thinking || leftMulligan || seatChanged) {
      this.clearTimer(match.id);
      match.thinking = false;
      match.turnToken += 1;
      const delayMs = this.clockDelay(match);
      match.deadline = Date.now() + delayMs;
      match.clockPhase = match.state.phase;
      match.clockSeat = actor;
      const token = match.turnToken;
      this.armClock(match.id, { kind: 'human', token, delayMs }, () => {
        void this.onTimeout(match.id, token);
      });
    }
  }

  /** Tutorial has no clock. Mulligan is 20s and keeps the hand. Later turns use the match's own length. */
  private clockDelay(match: MatchRecord): number {
    if (match.tutorial) return 0;
    if (match.thinking) return this.aiTurnMs;
    if (match.state.phase === 'mulligan') return MULLIGAN_MS;
    return match.humanTurnMs ?? this.turnTimeoutMs;
  }

  private startPilot(match: MatchRecord, depth: number): void {
    if (depth > 8) throw new Error('pilot_stuck');
    const actions = this.planPilot(match);
    if (actions.length === 0) throw new Error('pilot_stuck');
    const source: LogEntry['source'] = match.tutorial ? 'script' : 'pilot';
    if (this.aiTurnMs <= 0) {
      for (const action of actions) {
        if (actorOf(match.state) !== 1) break;
        if (!this.applyLogged(match, action, source)) throw new Error('pilot_illegal');
      }
      if (actorOf(match.state) === 1) throw new Error('pilot_stuck');
      match.thinking = false;
      match.deadline = null;
      this.syncClock(match, depth + 1);
      return;
    }
    match.thinking = true;
    match.deadline = Date.now() + this.aiTurnMs;
    const step = Math.max(1, Math.round(this.aiTurnMs / actions.length));
    this.plans.set(match.id, { expectedGen: match.generation, actions, next: 0, step });
    this.armClock(match.id, { kind: 'pilot', token: match.turnToken, delayMs: step }, () => {
      void this.stepPilot(match.id);
    });
  }

  private planPilot(match: MatchRecord): GameAction[] {
    if (match.tutorial) return scriptedTutorialTurn(match.state);
    const actions: GameAction[] = [];
    let state = match.state;
    for (let guard = 0; guard < 80 && actorOf(state) === 1; guard++) {
      const action = this.adapter.pilot(state, match.stance);
      actions.push(action);
      state = this.adapter.apply(state, action);
    }
    return actions;
  }

  private async stepPilot(id: string): Promise<void> {
    await this.lock(id, async () => {
      const match = await this.repo.get(id);
      const plan = this.plans.get(id);
      if (!match || !plan || match.generation !== plan.expectedGen) return;
      const action = plan.actions[plan.next];
      if (!action || actorOf(match.state) !== 1) {
        this.plans.delete(id);
        match.thinking = false;
        match.deadline = null;
        this.syncClock(match);
        await this.repo.put(match);
        return;
      }
      if (!this.applyLogged(match, action, match.tutorial ? 'script' : 'pilot')) throw new Error('pilot_illegal');
      plan.next += 1;
      plan.expectedGen = match.generation;
      if (plan.next >= plan.actions.length || actorOf(match.state) !== 1) {
        this.plans.delete(id);
        match.thinking = false;
        match.deadline = null;
        this.syncClock(match);
      } else {
        match.thinking = true;
        this.armClock(id, { kind: 'pilot', token: match.turnToken, delayMs: plan.step }, () => {
          void this.stepPilot(id);
        });
      }
      await this.repo.put(match);
    });
  }

  private async onTimeout(id: string, token: number): Promise<void> {
    await this.lock(id, async () => {
      const match = await this.repo.get(id);
      if (!match || match.turnToken !== token || match.state.winner >= 0 || match.friend?.forfeitedBy != null) return;
      const actor = actorOf(match.state);
      if (actor == null) return;
      if (!match.friend && actor !== 0) return;
      if (match.friend) {
        match.friend.misses[actor] += 1;
        if (match.friend.misses[actor] >= MISS_LIMIT) {
          match.friend.forfeitedBy = actor;
          match.generation += 1;
          match.deadline = null;
          match.thinking = false;
          this.clearTimer(match.id);
          await this.repo.put(match);
          this.note(match);
          return;
        }
      }
      const action: GameAction = match.state.phase === 'mulligan' ? { type: 'mulligan', idx: [] } : { type: 'end' };
      if (!this.applyLogged(match, action, 'timeout')) return;
      this.syncClock(match);
      await this.repo.put(match);
      this.note(match);
    });
  }

  private toClient(match: MatchRecord, viewer: PlayerId = 0): ClientPayload {
    const forfeited = match.friend?.forfeitedBy ?? null;
    const yourTurn = forfeited == null && !match.thinking && actorOf(match.state) === viewer;
    let view = this.annotateView(match, this.adapter.view(match.state, viewer));
    if (!yourTurn) view = { ...view, yourTurn: false };
    if (forfeited != null) {
      const winner: PlayerId = forfeited === 0 ? 1 : 0;
      view = { ...view, winner, winReason: 'forfeit', yourTurn: false, phase: 'game_over' };
    }
    const over = view.winner != null;
    const payload: ClientPayload = {
      matchId: match.id,
      view,
      legalActions: yourTurn ? this.adapter.legalActions(match.state, viewer) : [],
      turnDeadline: over ? null : match.deadline,
      turnDurationMs: this.clockDelay(match),
      opponentThinking: match.friend ? false : match.thinking,
      engineVersion: match.setup.engineVersion,
      cardsVersion: match.setup.cardsVersion,
      rulesVersion: match.setup.rulesVersion,
      aiVersion: match.setup.aiVersion,
      secondInkTurns: match.setup.rules.secondInkTurns,
      secondVerse: match.setup.rules.secondVerse ?? 0,
      stance: match.stance,
      status: over ? 'complete' : 'playing',
      tutorial: match.tutorial === true,
      friend: Boolean(match.friend),
      rematchCode: match.friend?.rematchCode && match.friend.rematchCode !== 'pending' ? match.friend.rematchCode : null,
      generation: match.generation,
    };
    assertClientSafe(payload, match, viewer);
    return payload;
  }

  private allows(match: MatchRecord, player: PlayerId): boolean {
    if (match.friend) return player === 0 || player === 1;
    return player === 0;
  }

  private note(match: MatchRecord): void {
    if (match.friend) this.options.onChange?.(match.id);
  }

  /** Page names for holds and conquers. Computed by replaying actions, never written into engine state. */
  private annotateView(match: MatchRecord, view: PlayerView): PlayerView {
    if (match.setup.engineVersion !== this.adapter.engineVersion) return view;
    try {
      const open = this.adapter.replay(match.setup, []);
      const notes = collectScoreNotes(open, match.log.map((entry) => entry.action), (state, action) => this.adapter.apply(state, action));
      return { ...view, events: applyScoreNotes(view.events, notes) };
    } catch {
      return view;
    }
  }

  private armClock(id: string, clock: ClockRequest, fire: () => void): void {
    if (this.clock) {
      this.clock.arm(clock);
      return;
    }
    this.timers.set(id, setTimeout(fire, clock.delayMs));
  }

  private clearTimer(id: string) {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.clock?.disarm();
  }

  private async lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(id) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prev.then(() => gate);
    this.tails.set(id, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(id) === tail) this.tails.delete(id);
    }
  }
}

function isServerId(value: string | undefined): value is string {
  return typeof value === 'string' && (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || FRIEND_CODE.test(value));
}

function friendOver(match: MatchRecord): boolean {
  return match.friend?.forfeitedBy != null || match.state.winner >= 0;
}

function randomSeed(): number {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return new DataView(bytes.buffer).getUint32(0, false);
}

function validateDecks(decks: readonly [Deck, Deck]): string | null {
  for (const deck of decks) {
    const error = deckError(deck.house, deck.cards);
    if (error) return error;
  }
  return null;
}

