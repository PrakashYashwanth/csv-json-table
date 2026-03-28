/** Measure string width in px using canvas (same as table body font). */
let measureCanvas: HTMLCanvasElement | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  return measureCanvas.getContext("2d");
}

export function measureTextWidth(text: string, fontCss: string): number {
  const ctx = getMeasureContext();
  if (!ctx) return text.length * 8;
  ctx.font = fontCss;
  return ctx.measureText(text).width;
}

function fontFromElement(el: HTMLElement): string {
  const cs = getComputedStyle(el);
  return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
}

/** Match real table cell typography (see main.css td rules). */
export function getEditorFontCss(): string {
  const table = document.createElement("table");
  table.className = "cvt-body-table";
  table.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;";
  table.innerHTML = "<tbody><tr><td>M</td></tr></tbody>";
  document.body.appendChild(table);
  const td = table.querySelector("td") as HTMLElement;
  const font = fontFromElement(td);
  document.body.removeChild(table);
  return font;
}

/** Match header row typography (see main.css .cvt-header-table thead th). */
export function getHeaderFontCss(): string {
  const table = document.createElement("table");
  table.className = "cvt-header-table";
  table.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;";
  table.innerHTML = "<thead><tr><th class='cvt-th'>M</th></tr></thead>";
  document.body.appendChild(table);
  const th = table.querySelector("th") as HTMLElement;
  const font = fontFromElement(th);
  document.body.removeChild(table);
  return font;
}

export interface AutoWidthOptions {
  header: string[];
  rows: string[][];
  displayOrder: number[];
  jsonColumns: Set<number>;
  /** Max rows to scan per column (sample from start of `rows`). */
  sampleMaxRows: number;
  cellFontCss: string;
  headerFontCss: string;
  minWidth: number;
  maxWidth: number;
  /** Horizontal padding + borders approx (px), both sides — data cells. */
  cellPaddingExtra: number;
  /**
   * Extra px for header cell chrome not in the title string: drag grip, resize gutter,
   * sort arrow, th padding (see .cvt-th in main.css).
   */
  headerChromeExtraPx: number;
}

function jsonPreviewForMeasure(cell: string): string {
  try {
    const obj = JSON.parse(cell) as Record<string, unknown>;
    const keys = Object.keys(obj).slice(0, 3);
    return `{${keys.join(",")}}`;
  } catch {
    return "JSON";
  }
}

export function computeAutoColumnWidths(opts: AutoWidthOptions): number[] {
  const n = opts.displayOrder.length;
  const widths = new Array<number>(n);
  const sample = Math.min(opts.rows.length, opts.sampleMaxRows);
  const pad = opts.cellPaddingExtra;

  const sortReservePx = measureTextWidth(" ▼", opts.headerFontCss);
  const chrome = opts.headerChromeExtraPx;

  for (let d = 0; d < n; d++) {
    const phys = opts.displayOrder[d];
    const title = opts.header[phys] ?? "";
    let headerPx =
      measureTextWidth(title, opts.headerFontCss) + sortReservePx + chrome;
    let maxPx = headerPx;
    for (let r = 0; r < sample; r++) {
      const row = opts.rows[r];
      if (!row) continue;
      const raw = row[phys] ?? "";
      const shown = opts.jsonColumns.has(phys)
        ? jsonPreviewForMeasure(raw)
        : raw;
      maxPx = Math.max(maxPx, measureTextWidth(shown, opts.cellFontCss) + pad);
    }
    const w = Math.ceil(maxPx);
    widths[d] = Math.min(opts.maxWidth, Math.max(opts.minWidth, w));
  }
  return widths;
}
