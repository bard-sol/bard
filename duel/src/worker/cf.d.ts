declare const WebSocketPair: {
  new (): { 0: WebSocket; 1: WebSocket };
};

declare module 'cloudflare:workers' {
  export interface SqlCursor {
    toArray(): Array<Record<string, string | null>>;
  }

  export interface DurableObjectState {
    blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
    storage: {
      sql: {
        exec(query: string, ...bindings: Array<string | null>): SqlCursor;
      };
      setAlarm(scheduledTime: number): Promise<void>;
      deleteAlarm(): Promise<void>;
    };
    acceptWebSocket(ws: WebSocket, tags?: string[]): void;
    getWebSockets(tag?: string): WebSocket[];
    getTags(ws: WebSocket): string[];
  }

  export abstract class DurableObject<E> {
    ctx: DurableObjectState;
    env: E;
    constructor(ctx: DurableObjectState, env: E);
  }
}
