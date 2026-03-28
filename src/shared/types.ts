/** One CSV row as string cells (after parse). */
export type CsvRow = string[];

/** Parsed CSV document. */
export interface ParsedCsv {
  header: CsvRow;
  rows: CsvRow[];
}

/** Undo/redo entry (row index in full `rows` array, not filtered view). */
export interface HistoryEntry {
  rowIndex: number;
  colIndex: number;
  oldValue: string;
  newValue: string;
}

export type SortDirection = "asc" | "desc";

export interface SortState {
  column: number | null;
  direction: SortDirection | null;
}
