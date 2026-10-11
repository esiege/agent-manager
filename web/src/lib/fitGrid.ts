// Picks how many columns the Dashboard uses so every tile fits on screen, as large and square as it can.

export interface GridFit {
  cols: number;
  rows: number;
  /** Size of one cell in px. In scroll mode tileH is the fixed row height. */
  tileW: number;
  tileH: number;
  /** True when even minTile-sized tiles don't fit, so the grid scrolls. */
  scroll: boolean;
}

/**
 * Tries every column count and keeps the one whose tiles have the largest short side
 * (min of width and height): that is both the biggest and the most square tile that still fits.
 * When none reaches minTile, it falls back to as many minTile-wide columns as fit and lets rows scroll.
 */
export function fitGrid(n: number, width: number, height: number, gap: number, minTile: number): GridFit {
  if (n <= 0 || width <= 0 || height <= 0) return { cols: 1, rows: 0, tileW: Math.max(width, 0), tileH: 0, scroll: false };

  let best: GridFit | null = null;
  let bestScore = -Infinity;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    // More columns that don't save a row only make tiles narrower.
    if (cols > 1 && Math.ceil(n / (cols - 1)) === rows) continue;
    const tileW = (width - gap * (cols - 1)) / cols;
    const tileH = (height - gap * (rows - 1)) / rows;
    const score = Math.min(tileW, tileH);
    if (score > bestScore) {
      bestScore = score;
      best = { cols, rows, tileW, tileH, scroll: false };
    }
  }
  if (best && bestScore >= minTile) return best;

  const cols = Math.max(1, Math.min(n, Math.floor((width + gap) / (minTile + gap))));
  return {
    cols,
    rows: Math.ceil(n / cols),
    tileW: (width - gap * (cols - 1)) / cols,
    tileH: minTile,
    scroll: true,
  };
}
