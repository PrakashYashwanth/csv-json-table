/**
 * Per-panel source of truth for disk baseline and dirty flag.
 * Webview content is not duplicated here; baseline matches last agreed disk state.
 */
export class StateManager {
  private baseline: string;
  private dirty = false;

  constructor(initialBaseline: string) {
    this.baseline = initialBaseline;
  }

  getBaseline(): string {
    return this.baseline;
  }

  /** Call after successful read from disk or after save write. */
  setBaseline(content: string): void {
    this.baseline = content;
  }

  setDirty(dirty: boolean): void {
    this.dirty = dirty;
  }

  isDirty(): boolean {
    return this.dirty;
  }
}
