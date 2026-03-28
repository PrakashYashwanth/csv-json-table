import type { CsvRow } from "../shared/types";
import { detectJsonColumnIndices as detect } from "../shared/jsonColumns";

/** Column indices whose cells parse as JSON objects or arrays. */
export function detectJsonColumnIndices(rows: CsvRow[]): Set<number> {
  return detect(rows);
}

export function tryFormatJson(cell: string): string {
  try {
    return JSON.stringify(JSON.parse(cell), null, 2);
  } catch {
    return cell;
  }
}

export function normalizeJsonToCell(editorText: string): string {
  const parsed = JSON.parse(editorText);
  return JSON.stringify(parsed);
}
