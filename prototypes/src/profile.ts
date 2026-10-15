const KEY = "bard.proto.profile.v1";

export interface Profile {
  renown: number;
  matchesPlayed: number;
  tutA: boolean;
  tutB: boolean;
  preferenceAsked: boolean;
  deckId: string;
  customDeck: string[] | null;
}

const DEFAULTS: Profile = {
  renown: 0,
  matchesPlayed: 0,
  tutA: false,
  tutB: false,
  preferenceAsked: false,
  deckId: "ranks",
  customDeck: null,
};

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Profile>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveProfile(p: Profile): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}
