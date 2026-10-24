/**
 * Visual tokens for the duel board.
 * Design's board comps replace this module. Gameplay code should not hardcode colors.
 */

export const tokens = {
  color: {
    bg: 0x140e0a,
    bgRaised: 0x241910,
    rail: 0x2c1f15,
    parchment: 0xf4e6c8,
    parchmentShade: 0xe4cfA3,
    ink: 0x1c140f,
    inkSoft: 0x6a5642,
    gold: 0xe8c56a,
    goldDeep: 0x8a5a12,
    ally: 0x1f5b43,
    allyEdge: 0x9ad7b4,
    foe: 0x7c342d,
    foeEdge: 0xf0b5a8,
    note: 0xfbf6e8,
    noteEdge: 0x8b7049,
    button: 0x3a291b,
    buttonHot: 0x6d4e24,
    danger: 0xd24b3e,
    good: 0x8ed7ae,
    line: 0x6e5638,
    muted: 0xcbbba3,
    white: 0xfff8ee,
    pipEmpty: 0x3a2b20,
    inkDrop: 0x4ea0d8,
  },
  font: {
    display: 'Liberation Serif, DejaVu Serif, Georgia, serif',
  },
  radius: {
    card: 12,
    slot: 8,
    pip: 7,
  },
  motion: {
    verseMs: 900,
  },
  layout: {
    phoneBreak: 820,
  },
} as const;

export function houseTint(house: string): number {
  if (house === 'candle') return 0xd3923a;
  if (house === 'fold') return 0xc25648;
  if (house === 'tidewrack') return 0x3c7f9a;
  return 0x8d7b68;
}
