/* global Papa */
import { detectJsonColumnIndices } from "../../shared/jsonColumns";
import type { HistoryEntry, SortState } from "../../shared/types";
import {
  computeAutoColumnWidths,
  getEditorFontCss,
  getHeaderFontCss,
} from "../columnSizing";

type PapaParseResult = {
  data: string[][];
};

type PapaParse = {
  parse<T>(input: string, config?: { skipEmptyLines?: boolean }): PapaParseResult;
  unparse(data: unknown[][]): string;
};

declare const Papa: PapaParse;

const MIN_COL_WIDTH = 48;
const MAX_COL_WIDTH = 640;
const AUTO_SAMPLE_ROWS = 500;

/** Map a display-column index after moving display column `from` → `to`. */
function isValidDisplayOrderPermutation(order: number[], n: number): boolean {
  if (order.length !== n) return false;
  const seen = new Set<number>();
  for (const x of order) {
    if (!Number.isInteger(x) || x < 0 || x >= n || seen.has(x)) return false;
    seen.add(x);
  }
  return seen.size === n;
}

function mapIndexAfterColumnMove(
  i: number,
  from: number,
  to: number,
): number {
  if (i === from) return to;
  if (from < to) {
    if (i > from && i <= to) return i - 1;
  } else if (from > to) {
    if (i >= to && i < from) return i + 1;
  }
  return i;
}

export class TableViewModel {
  header: string[] = [];
  rows: string[][] = [];
  filteredRows: string[][] = [];

  /** Display column d shows physical column `displayOrder[d]`. */
  displayOrder: number[] = [];
  /** Pixel width per display column. */
  columnWidths: number[] = [];
  /** Filter text per display column (substring match on physical cell). */
  filterByDisplay: string[] = [];
  /** First `freezeCount` display columns use sticky positioning when scrolling. */
  freezeCount = 0;

  sortState: SortState = { column: null, direction: null };
  readonly jsonColumns = new Set<number>();
  private readonly rowIdentityMap = new Map<string[], number>();

  selectedRow = 0;
  selectedCol = 0;

  /** Set of physical row indices that are checked for deletion */
  readonly checkedRows = new Set<number>();

  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];

  private onChange: (() => void) | undefined;

  setOnChange(cb: () => void): void {
    this.onChange = cb;
  }

  clearHistory(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  /** Physical column index for the cell shown at display column `d`. */
  physicalCol(d: number): number {
    return this.displayOrder[d] ?? d;
  }

  /** Raw cell value in filtered view (rows are stored in physical column order). */
  cellAtFiltered(filteredRow: number, displayCol: number): string {
    const row = this.filteredRows[filteredRow];
    if (!row) return "";
    return row[this.physicalCol(displayCol)] ?? "";
  }

  private applyAutoColumnWidths(): void {
    const n = this.header.length;
    if (n === 0) {
      this.columnWidths = [];
      return;
    }
    this.columnWidths = computeAutoColumnWidths({
      header: this.header,
      rows: this.rows,
      displayOrder: this.displayOrder,
      jsonColumns: this.jsonColumns,
      sampleMaxRows: AUTO_SAMPLE_ROWS,
      cellFontCss: getEditorFontCss(),
      headerFontCss: getHeaderFontCss(),
      minWidth: MIN_COL_WIDTH,
      maxWidth: MAX_COL_WIDTH,
      cellPaddingExtra: 28,
      /** Drag grip + resize strip + th padding — must fit full header row. */
      headerChromeExtraPx: 88,
    });
  }

  /**
   * @param silent - if true, do not notify (use while dragging; call `notifyChange()` after).
   */
  setColumnWidth(displayCol: number, widthPx: number, silent = false): void {
    if (displayCol < 0 || displayCol >= this.columnWidths.length) return;
    const w = Math.min(
      MAX_COL_WIDTH,
      Math.max(MIN_COL_WIDTH, Math.round(widthPx)),
    );
    if (this.columnWidths[displayCol] === w) return;
    this.columnWidths[displayCol] = w;
    if (!silent) this.onChange?.();
  }

  notifyChange(): void {
    this.onChange?.();
  }

  moveDisplayColumn(from: number, to: number): void {
    const n = this.displayOrder.length;
    if (n === 0 || from === to || from < 0 || to < 0 || from >= n || to >= n) {
      return;
    }
    const move = <T>(arr: T[]): void => {
      const [x] = arr.splice(from, 1);
      arr.splice(to, 0, x);
    };
    move(this.displayOrder);
    move(this.columnWidths);
    move(this.filterByDisplay);

    if (this.sortState.column !== null) {
      this.sortState = {
        column: mapIndexAfterColumnMove(this.sortState.column, from, to),
        direction: this.sortState.direction,
      };
    }
    this.selectedCol = mapIndexAfterColumnMove(this.selectedCol, from, to);
    this.pipeline();
  }

  setFreezeCount(count: number): void {
    const n = this.header.length;
    const c = Math.max(0, Math.min(n, Math.floor(count)));
    if (this.freezeCount === c) return;
    this.freezeCount = c;
    this.onChange?.();
  }

  private headersMatch(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }

  /**
   * Replace row data from disk while keeping filters, sort, column order, widths, and freeze
   * when the header row is unchanged (typical after Save).
   * Returns false if the CSV shape/header changed — caller should full `initialize()` instead.
   */
  applyReloadKeepingUi(csv: string): boolean {
    const parsed = Papa.parse<string[]>(csv.trim(), { skipEmptyLines: false });
    const data = parsed.data;
    if (data.length === 0) return false;

    const newHeader = data[0].map((c) => String(c ?? ""));
    if (!this.headersMatch(this.header, newHeader)) return false;

    const savedFilters = [...this.filterByDisplay];
    const savedOrder = [...this.displayOrder];
    const savedWidths = [...this.columnWidths];
    const savedSort = { ...this.sortState };
    const savedFreeze = this.freezeCount;

    const newRows = data.slice(1).map((r) => r.map((c) => String(c ?? "")));
    this.header = newHeader;
    this.rows = newRows;

    this.jsonColumns.clear();
    for (const i of detectJsonColumnIndices(this.rows)) {
      this.jsonColumns.add(i);
    }

    const n = this.header.length;
    if (savedFilters.length === n) {
      this.filterByDisplay = savedFilters;
    } else {
      this.filterByDisplay = new Array(n).fill("");
    }

    if (isValidDisplayOrderPermutation(savedOrder, n)) {
      this.displayOrder = savedOrder;
    } else {
      this.displayOrder = Array.from({ length: n }, (_, i) => i);
    }

    if (savedWidths.length === n) {
      this.columnWidths = savedWidths;
    } else {
      this.applyAutoColumnWidths();
    }

    this.freezeCount = Math.max(0, Math.min(n, savedFreeze));

    if (
      savedSort.column !== null &&
      savedSort.direction !== null &&
      savedSort.column >= 0 &&
      savedSort.column < n
    ) {
      this.sortState = {
        column: savedSort.column,
        direction: savedSort.direction,
      };
    } else {
      this.sortState = { column: null, direction: null };
    }

    this.rebuildIdentityMap();
    this.clearHistory();
    this.pipeline();
    return true;
  }

  initialize(csv: string): void {
    this.sortState = { column: null, direction: null };
    this.freezeCount = 0;
    this.checkedRows.clear();

    const parsed = Papa.parse<string[]>(csv.trim(), { skipEmptyLines: false });
    const data = parsed.data;
    if (data.length === 0) {
      this.header = [];
      this.rows = [];
      this.filteredRows = [];
      this.displayOrder = [];
      this.columnWidths = [];
      this.filterByDisplay = [];
      this.jsonColumns.clear();
    } else {
      this.header = data[0].map((c) => String(c ?? ""));
      this.rows = data.slice(1).map((r) => r.map((c) => String(c ?? "")));
      this.filteredRows = [...this.rows];
      const n = this.header.length;
      this.displayOrder = Array.from({ length: n }, (_, i) => i);
      this.filterByDisplay = new Array(n).fill("");
      this.jsonColumns.clear();
      for (const i of detectJsonColumnIndices(this.rows)) {
        this.jsonColumns.add(i);
      }
      this.applyAutoColumnWidths();
    }
    this.rebuildIdentityMap();
    this.selectedRow = 0;
    this.selectedCol = 0;
    this.clearHistory();
    this.pipeline();
  }

  private rebuildIdentityMap(): void {
    this.rowIdentityMap.clear();
    this.rows.forEach((row, index) => this.rowIdentityMap.set(row, index));
  }

  pipeline(): void {
    this.applyFilters();
    this.applySort();
    if (this.filteredRows.length === 0) {
      this.selectedRow = 0;
    } else {
      this.selectedRow = Math.min(
        this.selectedRow,
        this.filteredRows.length - 1,
      );
    }
    this.onChange?.();
  }

  private applyFilters(): void {
    this.filteredRows = this.rows.filter((row) => {
      for (let d = 0; d < this.displayOrder.length; d++) {
        const term = this.filterByDisplay[d];
        if (!term) continue;
        const phys = this.displayOrder[d];
        const cell = row[phys] ?? "";
        if (!String(cell).toLowerCase().includes(term.toLowerCase())) {
          return false;
        }
      }
      return true;
    });
  }

  private applySort(): void {
    if (this.sortState.column === null || this.sortState.direction === null) {
      return;
    }
    const d = this.sortState.column;
    const phys = this.displayOrder[d];
    const dir = this.sortState.direction;
    this.filteredRows.sort((a, b) => {
      let A: string | number = a[phys] ?? "";
      let B: string | number = b[phys] ?? "";
      if (!isNaN(Number(A)) && !isNaN(Number(B))) {
        A = Number(A);
        B = Number(B);
      }
      if (A < B) return dir === "asc" ? -1 : 1;
      if (A > B) return dir === "asc" ? 1 : -1;
      return 0;
    });
  }

  /** `displayCol` is the visible column index. */
  setSortColumn(displayCol: number, direction: "asc" | "desc"): void {
    if (displayCol < 0 || displayCol >= this.displayOrder.length) return;
    this.sortState = { column: displayCol, direction };
    this.pipeline();
  }

  clearSort(): void {
    this.sortState = { column: null, direction: null };
    this.pipeline();
  }

  setFilter(displayCol: number, value: string): void {
    if (displayCol < 0 || displayCol >= this.filterByDisplay.length) return;
    this.filterByDisplay[displayCol] = value;
    this.pipeline();
  }

  realIndexForFilteredRow(filteredRowIndex: number): number | undefined {
    const row = this.filteredRows[filteredRowIndex];
    return row !== undefined ? this.rowIdentityMap.get(row) : undefined;
  }

  pushHistory(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    this.redoStack.length = 0;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push(entry);
    this.rows[entry.rowIndex][entry.colIndex] = entry.oldValue;
    this.pipeline();
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push(entry);
    this.rows[entry.rowIndex][entry.colIndex] = entry.newValue;
    this.pipeline();
    return true;
  }

  setCellFromFiltered(
    filteredRowIndex: number,
    displayCol: number,
    newValue: string,
  ): void {
    const real = this.realIndexForFilteredRow(filteredRowIndex);
    if (real === undefined) return;
    const phys = this.physicalCol(displayCol);
    const oldValue = this.rows[real][phys];
    if (oldValue === newValue) return;
    this.pushHistory({
      rowIndex: real,
      colIndex: phys,
      oldValue,
      newValue,
    });
    this.rows[real][phys] = newValue;
    this.pipeline();
  }

  toCsvString(): string {
    return Papa.unparse([this.header, ...this.rows]);
  }

  jsonPreview(cell: string): string {
    try {
      const obj = JSON.parse(cell) as Record<string, unknown>;
      const keys = Object.keys(obj).slice(0, 3);
      return `{${keys.join(",")}}`;
    } catch {
      return "JSON";
    }
  }

  /** Cumulative left offset in px for sticky frozen columns up to (but not including) `displayCol`. */
  stickyLeftOffset(displayCol: number): number {
    let sum = 0;
    for (let d = 0; d < displayCol && d < this.columnWidths.length; d++) {
      sum += this.columnWidths[d] ?? 0;
    }
    return sum;
  }

  /**
   * Add a new empty row at the end of the table.
   * @returns the index of the new row in the full rows array
   */
  addRow(): number {
    const newRow = new Array(this.header.length).fill("");
    this.rows.push(newRow);
    this.rebuildIdentityMap();
    this.pipeline();
    // Select the new row, first column
    this.selectedRow = this.filteredRows.length - 1;
    this.selectedCol = 0;
    return this.rows.length - 1;
  }

  /**
   * Add a new row after the currently selected row.
   * @returns the index of the new row in the full rows array
   */
  addRowAfterSelected(): number {
    const real = this.realIndexForFilteredRow(this.selectedRow);
    if (real === undefined) return this.addRow();
    const newRow = new Array(this.header.length).fill("");
    this.rows.splice(real + 1, 0, newRow);
    this.rebuildIdentityMap();
    this.pipeline();
    this.selectedRow = Math.min(this.selectedRow + 1, this.filteredRows.length - 1);
    return real + 1;
  }

  /**
   * Toggle checkbox state for a row (filtered view index)
   */
  toggleRowCheck(filteredRowIndex: number): void {
    const realIndex = this.realIndexForFilteredRow(filteredRowIndex);
    if (realIndex !== undefined) {
      if (this.checkedRows.has(realIndex)) {
        this.checkedRows.delete(realIndex);
      } else {
        this.checkedRows.add(realIndex);
      }
    }
    this.onChange?.();
  }

  /**
   * Check if a row is checked (using filtered view index)
   */
  isRowChecked(filteredRowIndex: number): boolean {
    const realIndex = this.realIndexForFilteredRow(filteredRowIndex);
    return realIndex !== undefined && this.checkedRows.has(realIndex);
  }

  /**
   * Delete all checked rows
   * @returns true if any rows were deleted
   */
  deleteCheckedRows(): boolean {
    if (this.checkedRows.size === 0) return false;
    
    // Sort indices in descending order so we delete from end to start
    // (to avoid index shifting issues)
    const indicesToDelete = Array.from(this.checkedRows).sort((a, b) => b - a);
    
    for (const idx of indicesToDelete) {
      if (idx >= 0 && idx < this.rows.length) {
        this.rows.splice(idx, 1);
      }
    }
    
    this.checkedRows.clear();
    this.rebuildIdentityMap();
    this.pipeline();
    return true;
  }

  /**
   * Get count of checked rows
   */
  getCheckedRowCount(): number {
    return this.checkedRows.size;
  }

  /**
   * Clear all checked rows
   */
  clearCheckedRows(): void {
    this.checkedRows.clear();
    this.onChange?.();
  }
}
