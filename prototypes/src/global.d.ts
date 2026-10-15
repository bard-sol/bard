export {};

declare global {
  interface Window {
    HouseBar?: new (o: {
      width?: number;
      height?: number;
      dpr?: number;
      you?: string;
      rival?: string;
    }) => {
      canvas: HTMLCanvasElement;
      frame(t: number): void;
      win(you?: string, rival?: string): void;
      setHealth(map: Record<string, number>, animate?: boolean): void;
      activeLabels(t: number): { txt: string; x: number; a: number }[];
    };
  }
}
