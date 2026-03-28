/** Column indices whose cells parse as JSON objects or arrays. */
export function detectJsonColumnIndices(rows: string[][]): Set<number> {
  const jsonColumns = new Set<number>();
  for (const row of rows) {
    row.forEach((cell, i) => {
      if (typeof cell !== "string") return;
      const t = cell.trim();
      if (t.startsWith("{") || t.startsWith("[")) {
        try {
          JSON.parse(t);
          jsonColumns.add(i);
        } catch {
          /* not valid JSON */
        }
      }
    });
  }
  return jsonColumns;
}
