export const HOUSES = [
  { id: "pit", name: "The Pit", a: "#D9481C", b: "#4A4E54" },
  { id: "scriptorium", name: "The Scriptorium", a: "#1E7F72", b: "#23262E" },
  { id: "gilt", name: "The Gilt", a: "#D4B25A", b: "#F3ECDA" },
  { id: "tidewrack", name: "The Tidewrack", a: "#6FB3DD", b: "#C9A97E" },
  { id: "candle", name: "The Candle", a: "#8E2F5E", b: "#8B8580" },
  { id: "standard", name: "The Standard", a: "#2B4F8C", b: "#A7A9A6" },
  { id: "tornmargin", name: "The Torn Margin", a: "#C8862A", b: "#5E6B34" },
  { id: "fold", name: "The Fold", a: "#E4DCC8", b: "#5B5D63" },
] as const;

export type HouseId = (typeof HOUSES)[number]["id"];

export function houseById(id: string) {
  return HOUSES.find((h) => h.id === id) ?? null;
}

export function houseName(id: string): string {
  return houseById(id)?.name ?? "Neutral";
}
