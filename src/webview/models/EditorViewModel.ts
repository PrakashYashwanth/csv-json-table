/** Which filtered cell is open in the JSON overlay editor. */
export class EditorViewModel {
  editingRow: number | null = null;
  editingCol: number | null = null;

  clear(): void {
    this.editingRow = null;
    this.editingCol = null;
  }

  set(r: number, c: number): void {
    this.editingRow = r;
    this.editingCol = c;
  }
}
