import * as Papa from "papaparse";
import type { ParsedCsv } from "../shared/types";

export function parseCsv(csv: string): ParsedCsv {
  const parsed = Papa.parse<string[]>(csv.trim(), {
    skipEmptyLines: false,
  });
  const data = parsed.data;
  if (data.length === 0) {
    return { header: [], rows: [] };
  }
  const header = data[0].map((c) => String(c ?? ""));
  const rows = data.slice(1).map((r) => r.map((c) => String(c ?? "")));
  return { header, rows };
}

/** Build CSV string from header row + body rows. */
export function toCsvString(header: string[], rows: string[][]): string {
  return Papa.unparse([header, ...rows]);
}
