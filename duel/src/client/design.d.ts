/** Design pack builders. Loaded as classic scripts from /design before the module. */
export {};

declare global {
  interface Window {
    D13: {
      cards: Record<string, { art: string; name: string; mini?: string; cost: number; type: string; house: string }>;
      pages: Array<{ id: string; name: string; text: string }>;
      legends: Record<string, { name: string; champion: string; text: string; cost: number }>;
    };
    cardFace: (id: string, options?: Record<string, unknown>) => string;
    boardScreen: (state: unknown, options?: Record<string, unknown>) => string;
    coach: (options: Record<string, unknown>) => void;
    icon: (name: string, cls?: string) => string;
    bardSays: (text: string, options?: Record<string, unknown>) => string;
    IS_PHONE: () => boolean;
    KW13: Record<string, { name: string; short: string; long: string }>;
    KW_ORDER: string[];
    KWI: Record<string, string>;
    __duel?: unknown;
    __duelGuide?: { step: number | null };
    __guideSeen?: string[];
  }
}
