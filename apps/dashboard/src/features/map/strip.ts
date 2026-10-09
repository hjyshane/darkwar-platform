// The shape of a figure in the strip at the head of a map screen. The cells
// themselves are built where the numbers are (hunt.ts for trucks and plunder);
// the atlas draws its own from the loaded map.

export interface StripCell {
  label: string;
  value: string | null;
  note?: string;
}
