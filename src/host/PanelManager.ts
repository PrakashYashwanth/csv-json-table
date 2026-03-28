import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { FileSyncService } from "./FileSyncService";
import { MessageHandler } from "./MessageHandler";
import { StateManager } from "./StateManager";

function escapeHtmlAttribute(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function panelBaseTitleForPath(filePath: string): string {
  return `CSV ${path.basename(filePath)}`;
}

/**
 * Opens a webview panel for one CSV file and wires file sync + messages.
 */
export function openCsvTablePanel(
  context: vscode.ExtensionContext,
  resource: vscode.Uri,
): void {
  const filePath = resource.fsPath;
  let initial = "";
  try {
    initial = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    void vscode.window.showErrorMessage(`Cannot open file: ${String(e)}`);
    return;
  }

  const baseTitle = panelBaseTitleForPath(filePath);
  const webviewTitleHtml = escapeHtmlAttribute(baseTitle);

  const panel = vscode.window.createWebviewPanel(
    "csvTable",
    baseTitle,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true, // CRITICAL: Keep webview state when hidden
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    },
  );

  const state = new StateManager(initial);
  let session!: PanelSession;
  const fileSync = new FileSyncService(filePath, () =>
    session.scheduleDiskCheck(),
  );
  session = new PanelSession(panel, state, fileSync, filePath, baseTitle);

  panel.webview.html = buildWebviewHtml(
    panel.webview,
    context.extensionUri,
    webviewTitleHtml,
  );

  const handler = new MessageHandler({
    panel,
    state,
    fileSync,
    updateTitle: () => session.updateTitle(),
  });

  panel.webview.onDidReceiveMessage((m) => handler.handle(m));

  fileSync.start();

  panel.onDidChangeViewState((e) => {
    session.onVisibilityChange(e.webviewPanel.visible);
  });

  panel.onDidDispose(() => {
    fileSync.dispose();
    session.dispose();
  });
}

class PanelSession {
  private diskCheckTimer: ReturnType<typeof setTimeout> | undefined;
  private lastFileWatcherNotify = 0;

  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly state: StateManager,
    private readonly fileSync: FileSyncService,
    private readonly filePath: string,
    private readonly baseTitle: string,
  ) {}

  updateTitle(): void {
    this.panel.title = this.state.isDirty()
      ? `${this.baseTitle} ●`
      : this.baseTitle;
  }

  scheduleDiskCheck(): void {
    console.log('[PanelSession] scheduleDiskCheck called');
    this.lastFileWatcherNotify = Date.now();
    if (this.diskCheckTimer) clearTimeout(this.diskCheckTimer);
    this.diskCheckTimer = setTimeout(() => {
      this.diskCheckTimer = undefined;
      this.handleDiskMaybeChanged();
    }, 120);
  }
  
  onVisibilityChange(visible: boolean): void {
    if (!visible) return;
    
    // Only check if we haven't had a file watcher notification in the last 5 seconds
    const timeSinceLastNotify = Date.now() - this.lastFileWatcherNotify;
    console.log('[PanelSession] onVisibilityChange, timeSinceLastNotify:', timeSinceLastNotify);
    
    if (timeSinceLastNotify > 5000) {
      console.log('[PanelSession] Checking disk on visibility change');
      this.scheduleDiskCheck();
    } else {
      console.log('[PanelSession] Skipping disk check - recent file watcher notification');
    }
  }

  dispose(): void {
    if (this.diskCheckTimer) clearTimeout(this.diskCheckTimer);
  }

  private handleDiskMaybeChanged(): void {
    console.log('[PanelSession] handleDiskMaybeChanged called');
    let latest: string;
    try {
      latest = fs.readFileSync(this.filePath, "utf8");
    } catch (e) {
      console.log('[PanelSession] Failed to read file:', e);
      return;
    }
    
    const baseline = this.state.getBaseline();
    const isDirty = this.state.isDirty();
    
    console.log('[PanelSession] Disk check:', {
      latestLength: latest.length,
      baselineLength: baseline.length,
      isDirty,
      contentChanged: latest !== baseline
    });
    
    // CRITICAL: If content hasn't changed, don't do anything
    if (latest === baseline) {
      console.log('[PanelSession] Content unchanged, skipping reload');
      return;
    }

    console.log('[PanelSession] Content changed on disk!');

    if (isDirty) {
      console.log('[PanelSession] Webview has unsaved changes, showing warning');
      void vscode.window
        .showWarningMessage(
          "The CSV file changed on disk while the table has unsaved edits.",
          "Apply disk version",
          "Keep table edits",
        )
        .then((choice) => {
          console.log('[PanelSession] User choice:', choice);
          if (choice !== "Apply disk version") {
            console.log('[PanelSession] User chose to keep table edits');
            return;
          }
          console.log('[PanelSession] Applying disk version to webview');
          try {
            const csv = fs.readFileSync(this.filePath, "utf8");
            this.state.setBaseline(csv);
            this.state.setDirty(false);
            this.updateTitle();
            void this.panel.webview.postMessage({
              command: "reload",
              data: csv,
              reason: "external",
              skipDirtyConfirm: true,
            });
          } catch (e) {
            console.log('[PanelSession] Failed to reload:', e);
          }
        });
    } else {
      console.log('[PanelSession] No unsaved changes, auto-reloading');
      this.state.setBaseline(latest);
      void this.panel.webview.postMessage({
        command: "reload",
        data: latest,
        reason: "external",
        skipDirtyConfirm: true,
      });
    }
  }
}

function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  webviewTitleEscaped: string,
): string {
  const mediaRoot = vscode.Uri.joinPath(extensionUri, "media");
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(mediaRoot, "webview.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(mediaRoot, "main.css"),
  );
  const templatePath = path.join(extensionUri.fsPath, "media", "index.html");
  const template = fs.readFileSync(templatePath, "utf8");
  const csp = webview.cspSource;
  return template
    .replace(/\{\{CSP_SOURCE\}\}/g, csp)
    .replace(/\{\{SCRIPT_URI\}\}/g, scriptUri.toString())
    .replace(/\{\{STYLE_URI\}\}/g, styleUri.toString())
    .replace(/\{\{WEBVIEW_TITLE\}\}/g, webviewTitleEscaped);
}
