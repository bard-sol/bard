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
  }

  export abstract class DurableObject<E> {
    ctx: DurableObjectState;
    env: E;
    constructor(ctx: DurableObjectState, env: E);
  }
}
