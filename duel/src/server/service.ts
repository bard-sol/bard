import { actorOf, buildSetup, deckError, IllegalActionError, sameAction } from '../engine/adapter.js';
import { cardFace } from '../engine/project.js';
import type { EngineState } from '../engine/state.js';
import type { ClientPayload, Deck, EngineAdapter, GameAction, PlayerId, Stance, TradePreview } from '../types.js';
import { assertClientSafe } from './redact.js';
import type { LogEntry, MatchRecord, MatchRepository } from './store.js';

export const DEFAULT_TURN_MS = 35_000;
export const DEFAULT_AI_TURN_MS = 5_000;

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
    private readonly options: { turnTimeoutMs?: number; aiTurnMs?: number } = {},
    private readonly clock?: TimerBridge,
  ) {}

  get turnTimeoutMs(): number {
    return this.options.turnTimeoutMs ?? DEFAULT_TURN_MS;
  }

  get aiTurnMs(): number {
    return this.options.aiTurnMs ?? DEFAULT_AI_TURN_MS;
  }

  async create(input: CreateMatchInput): Promise<ServiceResult<ClientPayload>> {
    const invalid = validateDecks(input.decks);
    if (invalid) return { ok: false, error: 'bad_deck' };
    const id = isUuid(input.id) ? input.id : crypto.randomUUID();
    const seed = input.seed != null ? input.seed >>> 0 : randomSeed();
    const setup = buildSetup(input.decks, seed, this.adapter);
    let state: EngineState;
    try {
      state = this.adapter.initialState(input.decks, setup.seed);
    } catch {
      return { ok: false, error: 'bad_deck' };
    }
    const match: MatchRecord = {
      id,
      setup,
      stance: input.stance,
      state,
      log: [],
      generation: 0,
      turnToken: 0,
      thinking: false,
      deadline: null,
      createdAt: new Date().toISOString(),
    };
    await this.lock(id, async () => {
      this.syncClock(match);
      await this.repo.put(match);
    });
    return { ok: true, payload: this.toClient(match) };
  }

  async get(id: string): Promise<ServiceResult<ClientPayload>> {
    const match = await this.repo.get(id);
    if (!match) return { ok: false, error: 'not_found' };
    return { ok: true, payload: this.toClient(match) };
  }

  async act(id: string, player: PlayerId, action: GameAction): Promise<ServiceResult<ClientPayload>> {
    if (player !== 0) return { ok: false, error: 'forbidden_view' };
    return this.lock(id, async () => {
      const match = await this.repo.get(id);
      if (!match) return { ok: false, error: 'not_found' };
      if (match.thinking || actorOf(match.state) !== 0) return { ok: false, error: 'opponent_turn' };
      const applied = this.applyLogged(match, action, 'human');
      if (!applied) return { ok: false, error: 'illegal_action' };
      this.syncClock(match);
      await this.repo.put(match);
      return { ok: true, payload: this.toClient(match) };
    });
  }

  async preview(id: string, player: PlayerId, action: GameAction): Promise<ServiceResult<{ matchId: string; preview: TradePreview }>> {
    if (player !== 0) return { ok: false, error: 'forbidden_view' };
    if (action.type !== 'attack') return { ok: false, error: 'illegal_action' };
    const match = await this.repo.get(id);
    if (!match) return { ok: false, error: 'not_found' };
    if (match.thinking || actorOf(match.state) !== 0) return { ok: false, error: 'opponent_turn' };
    try {
      const next = this.adapter.apply(match.state, action);
      const preview = diffAttack(match.state, next, action);
      const payload = { matchId: id, preview };
      assertClientSafe(payload, match, 0);
      return { ok: true, payload };
    } catch (error) {
      if (error instanceof IllegalActionError) return { ok: false, error: 'illegal_action' };
      throw error;
    }
  }

  async replayVerify(id: string): Promise<ServiceResult<ReplayReport>> {
    const match = await this.repo.get(id);
    if (!match) return { ok: false, error: 'not_found' };
    const mismatches: string[] = [];
    if (match.setup.engineVersion !== this.adapter.engineVersion) mismatches.push('engine_version');
    if (match.setup.cardsVersion !== this.adapter.cardsVersion) mismatches.push('cards_version');
    if (match.setup.aiVersion !== this.adapter.aiVersion) mismatches.push('ai_version');
    if (match.setup.rulesVersion !== this.adapter.rulesVersion) mismatches.push('rules_version');
    if (match.setup.rules.secondInkTurns !== this.adapter.rules.secondInkTurns) mismatches.push('second_ink');
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
      let state = this.adapter.initialState(decksOf(match), match.setup.seed);
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
    const inputs = match.log.filter((entry) => entry.source !== 'pilot');
    let state = this.adapter.initialState(decksOf(match), match.setup.seed);
    let cursor = 0;
    for (let guard = 0; guard < 5000 && actorOf(state) != null; guard++) {
      const actor = actorOf(state);
      try {
        if (actor === 1) {
          state = this.adapter.apply(state, this.adapter.pilot(state, match.stance));
        } else {
          const next = inputs[cursor];
          if (!next) return { mismatch: 'missing_player_action' };
          cursor += 1;
          state = this.adapter.apply(state, next.action);
        }
      } catch {
        return { mismatch: 'pure_apply' };
      }
    }
    if (cursor !== inputs.length) return { mismatch: 'unconsumed_actions' };
    return { state };
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
    if (actor == null) {
      this.clearTimer(match.id);
      this.plans.delete(match.id);
      match.thinking = false;
      match.deadline = null;
      return;
    }
    if (actor === 1) {
      this.clearTimer(match.id);
      match.turnToken += 1;
      this.startPilot(match, depth);
      return;
    }
    if (match.deadline == null || match.thinking) {
      this.clearTimer(match.id);
      match.thinking = false;
      match.turnToken += 1;
      match.deadline = Date.now() + this.turnTimeoutMs;
      const token = match.turnToken;
      this.armClock(match.id, { kind: 'human', token, delayMs: this.turnTimeoutMs }, () => {
        void this.onTimeout(match.id, token);
      });
    }
  }

  private startPilot(match: MatchRecord, depth: number): void {
    if (depth > 8) throw new Error('pilot_stuck');
    const actions = this.planPilot(match);
    if (actions.length === 0) throw new Error('pilot_stuck');
    if (this.aiTurnMs <= 0) {
      for (const action of actions) {
        if (actorOf(match.state) !== 1) break;
        if (!this.applyLogged(match, action, 'pilot')) throw new Error('pilot_illegal');
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
      if (!this.applyLogged(match, action, 'pilot')) throw new Error('pilot_illegal');
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
      if (!match || match.turnToken !== token || match.state.winner >= 0) return;
      if (actorOf(match.state) !== 0) return;
      const action: GameAction = match.state.phase === 'mulligan' ? { type: 'mulligan', idx: [] } : { type: 'end' };
      if (!this.applyLogged(match, action, 'timeout')) return;
      this.syncClock(match);
      await this.repo.put(match);
    });
  }

  private toClient(match: MatchRecord): ClientPayload {
    const yourTurn = !match.thinking && actorOf(match.state) === 0;
    const payload: ClientPayload = {
      matchId: match.id,
      view: this.adapter.view(match.state, 0),
      legalActions: yourTurn ? this.adapter.legalActions(match.state, 0) : [],
      turnDeadline: match.deadline,
      turnDurationMs: match.thinking ? this.aiTurnMs : this.turnTimeoutMs,
      opponentThinking: match.thinking,
      engineVersion: match.setup.engineVersion,
      cardsVersion: match.setup.cardsVersion,
      rulesVersion: match.setup.rulesVersion,
      aiVersion: match.setup.aiVersion,
      secondInkTurns: match.setup.rules.secondInkTurns,
      stance: match.stance,
      status: match.state.winner >= 0 ? 'complete' : 'playing',
    };
    if (!yourTurn) payload.view = { ...payload.view, yourTurn: false };
    assertClientSafe(payload, match, 0);
    return payload;
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

function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function randomSeed(): number {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return new DataView(bytes.buffer).getUint32(0, false);
}

function decksOf(match: MatchRecord): [Deck, Deck] {
  return [
    { house: match.setup.houseA, legendId: '', cards: match.setup.deckA },
    { house: match.setup.houseB, legendId: '', cards: match.setup.deckB },
  ];
}

function validateDecks(decks: readonly [Deck, Deck]): string | null {
  for (const deck of decks) {
    const error = deckError(deck.house, deck.cards);
    if (error) return error;
  }
  return null;
}

function findUnit(state: EngineState, uid: number) {
  for (const page of state.board) {
    for (const side of page) {
      for (const unit of side) if (unit.uid === uid) return unit;
    }
  }
  return null;
}

function diffAttack(before: EngineState, after: EngineState, action: { uid: number; target: number }): TradePreview {
  const attacker = findUnit(before, action.uid);
  const defender = findUnit(before, action.target);
  if (!attacker || !defender) throw new IllegalActionError();
  const attackerAfter = findUnit(after, attacker.uid);
  const defenderAfter = findUnit(after, defender.uid);
  const notesBefore = before.traps.filter((trap) => trap.page === attacker.page && trap.owner !== attacker.owner).length;
  const notesAfter = after.traps.filter((trap) => trap.page === attacker.page && trap.owner !== attacker.owner).length;
  const attackerCard = cardFace(attacker.id, String(attacker.uid));
  const defenderCard = cardFace(defender.id, String(defender.uid));
  return {
    attackerId: String(attacker.uid),
    defenderId: String(defender.uid),
    attackerName: attackerCard.name,
    defenderName: defenderCard.name,
    attackerHealthBefore: attacker.hp,
    defenderHealthBefore: defender.hp,
    attackerHealthAfter: attackerAfter?.hp ?? 0,
    defenderHealthAfter: defenderAfter?.hp ?? 0,
    attackerDies: !attackerAfter,
    defenderDies: !defenderAfter,
    verseGain: after.players[attacker.owner].verses - before.players[attacker.owner].verses,
    marginNoteStrikes: notesAfter < notesBefore,
  };
}
