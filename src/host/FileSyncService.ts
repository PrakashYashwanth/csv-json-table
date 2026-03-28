import * as fs from "fs";

const DEBOUNCE_MS = 250;

/**
 * Watches the CSV file on disk and notifies when content may have diverged from baseline.
 */
export class FileSyncService {
  private watcher: fs.FSWatcher | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly filePath: string,
    private readonly onDiskChanged: () => void,
  ) {}

  start(): void {
    this.disposeWatcher();
    try {
      this.watcher = fs.watch(this.filePath, () => this.scheduleNotify());
    } catch {
      /* file may be missing briefly; ignore */
    }
  }

  readFile(): string {
    return fs.readFileSync(this.filePath, "utf8");
  }

  writeFile(content: string): void {
    fs.writeFileSync(this.filePath, content, "utf8");
  }

  private scheduleNotify(): void {
    console.log('[FileSyncService] File change detected, scheduling notify');
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      console.log('[FileSyncService] Calling onDiskChanged callback');
      this.onDiskChanged();
    }, DEBOUNCE_MS);
  }

  private disposeWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.disposeWatcher();
  }
}
