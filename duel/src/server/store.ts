import type { GameAction, PlayerId, Stance } from '../types.js';
import type { EngineState, MatchSetup } from '../engine/state.js';

export interface LogEntry {
  index: number;
  actor: PlayerId;
  source: 'human' | 'pilot' | 'timeout' | 'script';
  action: GameAction;
}

/**
 * Server-only match record. `setup` is the replay input: decks, seed, versions,
 * and rules (including the second player's first-turn Ink). Never send it to the client.
 */
export interface MatchRecord {
  id: string;
  setup: MatchSetup;
  stance: Stance;
  state: EngineState;
  log: LogEntry[];
  generation: number;
  turnToken: number;
  thinking: boolean;
  deadline: number | null;
  createdAt: string;
  /** Guided first match. The rival's moves are the bubble-guide script, not the pilot. */
  tutorial?: boolean;
  /** Human turn length for this match. Mulligan uses its own clock. */
  humanTurnMs?: number;
  /** Phase the current human clock was armed for. Leaving mulligan starts a fresh turn clock. */
  clockPhase?: string;
  /** Seat the current human clock belongs to. A friend match re-arms when the seat changes. */
  clockSeat?: PlayerId;
  /** Two human seats. Absent on AI and tutorial matches. */
  friend?: {
    sessions: [string, string];
    deckIds: [string, string];
    misses: [number, number];
    forfeitedBy: PlayerId | null;
    rematchCode: string | null;
  };
}

export interface MatchRepository {
  put(match: MatchRecord): Promise<void>;
  get(id: string): Promise<MatchRecord | null>;
}

export class MemoryMatchRepository implements MatchRepository {
  private readonly rows = new Map<string, string>();

  async put(match: MatchRecord): Promise<void> {
    this.rows.set(match.id, JSON.stringify(match));
  }

  async get(id: string): Promise<MatchRecord | null> {
    const raw = this.rows.get(id);
    if (!raw) return null;
    return JSON.parse(raw) as MatchRecord;
  }
}
